package com.ohi.xgent.mobileassistant

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.AtomicFile
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.tauri.annotation.InvokeArg
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.json.JSONObject

@InvokeArg
class ResultDeliveryConfigurationArgs {
    var databasePath: String = ""
    var hostId: String = ""
    var targetJson: String = ""
}

internal data class ResultDeliveryScope(val databasePath: String, val hostId: String)

/** Original private database, inbox IDs and actual OS notification acceptance. */
internal object ResultDelivery {
    private const val WORK_NAME = "xgent.result.delivery.v1"
    private val configurationLock = Any()
    private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "xgent-result-delivery-v1.json"))

    private fun database(context: Context, path: String): File {
        val root = File(context.applicationInfo.dataDir).canonicalFile
        val candidate = File(path).canonicalFile
        require(candidate.path.startsWith(root.path + File.separator) && candidate.name == "config.sqlite" && candidate.isFile) {
            "Result delivery requires the original private native database"
        }
        return candidate
    }

    internal fun load(context: Context): ResultDeliveryScope? = synchronized(configurationLock) {
        val saved = file(context)
        if (!saved.baseFile.exists() && !File(saved.baseFile.path + ".bak").exists()) return@synchronized null
        val data = saved.openRead().use { input ->
            val buffer = ByteArray(8193)
            var count = 0
            while (count < buffer.size) {
                val read = input.read(buffer, count, buffer.size - count)
                if (read < 0) break
                count += read
            }
            require(count in 1..8192) { "Invalid retained result delivery configuration size" }
            buffer.copyOf(count).toString(Charsets.UTF_8)
        }
        val value = JSONObject(data)
        require(value.length() == 3 && value.getInt("version") == 1) { "Invalid result delivery configuration" }
        val id = value.getString("hostId")
        require(UUID.fromString(id).toString() == id) { "Invalid original result host" }
        ResultDeliveryScope(database(context, value.getString("databasePath")).path, id)
    }

    private fun verifyOwner(db: SQLiteDatabase, scope: ResultDeliveryScope) {
        db.rawQuery("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", null).use { rows ->
            check(rows.moveToFirst() && rows.getString(0) == scope.hostId) { "Result delivery original installation changed" }
        }
    }

    fun configure(context: Context, args: ResultDeliveryConfigurationArgs) = synchronized(configurationLock) {
        require(UUID.fromString(args.hostId).toString() == args.hostId) { "A canonical native result host is required" }
        val scope = ResultDeliveryScope(database(context, args.databasePath).path, args.hostId)
        SQLiteDatabase.openDatabase(scope.databasePath, null,
            SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS).use { db -> verifyOwner(db, scope) }
        val prior = load(context)
        check(prior == null || prior == scope) { "Retained result delivery cannot adopt another installation/database" }
        if (prior == null) {
            val saved = file(context)
            val output = saved.startWrite()
            try {
                output.write(JSONObject().put("version", 1).put("databasePath", scope.databasePath)
                    .put("hostId", scope.hostId).toString().toByteArray(Charsets.UTF_8))
                saved.finishWrite(output)
            } catch (error: Exception) { saved.failWrite(output); throw error }
        }
        RemoteResultDelivery.configure(context, scope, args.targetJson)
        val work = PeriodicWorkRequestBuilder<ResultDeliveryWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, work)
            .result.get(15, TimeUnit.SECONDS)
    }

    fun drain(context: Context, stopped: () -> Boolean): Boolean {
        val scope = load(context) ?: return true
        if (stopped()) return false
        // No CREATE_IF_NECESSARY: failure never manufactures an empty inbox.
        SQLiteDatabase.openDatabase(database(context, scope.databasePath).path, null,
            SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.NO_LOCALIZED_COLLATORS or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING).use { db ->
            // Match the native store's durable acceptance contract on this
            // write connection, rather than Android's usual WAL NORMAL mode.
            db.execSQL("PRAGMA synchronous=FULL")
            verifyOwner(db, scope)
            val candidates = mutableListOf<String>()
            db.rawQuery("""SELECT i.entry_id FROM automation_result_inbox i WHERE i.read_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM automation_result_inbox newer WHERE newer.request_id = i.request_id AND newer.sequence > i.sequence)
                AND NOT EXISTS (SELECT 1 FROM automation_result_notifications n WHERE n.entry_id = i.entry_id)
                ORDER BY i.sequence ASC LIMIT ?1""", arrayOf("20")).use { rows ->
                while (rows.moveToNext()) candidates.add(rows.getString(0))
            }
            var failed = false
            for (id in candidates) {
                if (stopped()) return false
                try {
                    require(UUID.fromString(id).toString() == id) { "Invalid retained inbox identity" }
                    db.beginTransactionNonExclusive()
                    try {
                        db.rawQuery("PRAGMA synchronous", null).use { rows ->
                            check(rows.moveToFirst() && rows.getInt(0) == 2) { "Durable OS acceptance requires SQLite FULL synchronization" }
                        }
                        verifyOwner(db, scope)
                        val ready = db.rawQuery("""SELECT i.entry_id FROM automation_result_inbox i WHERE i.entry_id = ?1 AND i.read_at IS NULL
                            AND NOT EXISTS (SELECT 1 FROM automation_result_inbox newer WHERE newer.request_id = i.request_id AND newer.sequence > i.sequence)
                            AND NOT EXISTS (SELECT 1 FROM automation_result_notifications n WHERE n.entry_id = i.entry_id)""", arrayOf(id)).use { rows -> rows.moveToFirst() }
                        if (!ready) { db.setTransactionSuccessful(); continue }
                        if (stopped()) return false
                        when (ResultNotifications.postRetained(context, id)) {
                            "blocked" -> return true // No OS request/grant; retry on the next OS period.
                            "accepted" -> {
                                // SQLite versions on old supported Androids lack UPSERT.
                                db.execSQL("INSERT OR IGNORE INTO automation_result_notifications (entry_id, accepted_at) SELECT entry_id, ?2 FROM automation_result_inbox WHERE entry_id = ?1",
                                    arrayOf<Any>(id, System.currentTimeMillis()))
                                db.setTransactionSuccessful()
                            }
                            else -> error("Unconfirmed OS result notification receipt")
                        }
                    } finally { db.endTransaction() }
                } catch (error: Exception) { failed = true }
            }
            return !failed
        }
    }
}
