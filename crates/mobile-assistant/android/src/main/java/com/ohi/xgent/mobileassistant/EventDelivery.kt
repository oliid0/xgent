package com.ohi.xgent.mobileassistant

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.AtomicFile
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import app.tauri.annotation.InvokeArg
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

@InvokeArg
class EventDeliveryConfigurationArgs {
    var databasePath: String = ""
    var hostId: String = ""
    var enabled: Boolean = false
}

/** Scope metadata contains no paired cookies, provider keys, samples or prompts. */
internal object EventDelivery {
    private const val PERIODIC = "xgent.event.delivery.v1"
    private const val IMMEDIATE = "xgent.event.delivery.once.v1"
    private val lock = Any()
    private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "xgent-event-delivery-v1.json"))
    private fun database(context: Context, path: String): File {
        val root = File(context.applicationInfo.dataDir).canonicalFile
        val db = File(path).canonicalFile
        require(db.path.startsWith(root.path + File.separator) && db.name == "config.sqlite" && db.isFile)
        return db
    }
    private fun verify(context: Context, scope: ResultDeliveryScope, enabled: Boolean) {
        require(UUID.fromString(scope.hostId).toString() == scope.hostId)
        SQLiteDatabase.openDatabase(database(context, scope.databasePath).path, null,
            SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS).use { db ->
            db.rawQuery("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'", null).use { rows ->
                check(rows.moveToFirst() && rows.getString(0) == scope.hostId)
            }
            db.rawQuery("SELECT value FROM automation_meta WHERE key='event_sender_scope.v1'", null).use { rows ->
                check(rows.moveToFirst())
                val saved = JSONObject(rows.getString(0))
                check(saved.getInt("version") == 1 && saved.getString("databasePath") == scope.databasePath &&
                    saved.getString("hostId") == scope.hostId && saved.getBoolean("enabled") == enabled)
            }
        }
    }
    fun load(context: Context): ResultDeliveryScope? = synchronized(lock) {
        val saved = file(context)
        if (!saved.baseFile.exists() && !File(saved.baseFile.path + ".bak").exists()) return@synchronized null
        val bytes = saved.openRead().use { input ->
            val buffer = ByteArray(8193); var count = 0
            while (count < buffer.size) { val read = input.read(buffer, count, buffer.size - count); if (read < 0) break; count += read }
            require(count in 1..8192); buffer.copyOf(count)
        }
        val value = JSONObject(bytes.toString(Charsets.UTF_8))
        require(value.length() == 3 && value.getInt("version") == 1)
        val scope = ResultDeliveryScope(database(context, value.getString("databasePath")).path, value.getString("hostId"))
        verify(context, scope, true); scope
    }
    fun configure(context: Context, args: EventDeliveryConfigurationArgs) = synchronized(lock) {
        val scope = ResultDeliveryScope(database(context, args.databasePath).path, args.hostId)
        verify(context, scope, args.enabled)
        val manager = WorkManager.getInstance(context)
        if (!args.enabled) {
            file(context).delete()
            manager.cancelUniqueWork(PERIODIC).result.get(15, TimeUnit.SECONDS)
            manager.cancelUniqueWork(IMMEDIATE).result.get(15, TimeUnit.SECONDS)
            return@synchronized
        }
        val prior = load(context)
        check(prior == null || prior == scope) { "Original event installation changed" }
        val saved = file(context); val output = saved.startWrite()
        try {
            output.write(JSONObject().put("version", 1).put("databasePath", scope.databasePath)
                .put("hostId", scope.hostId).toString().toByteArray(Charsets.UTF_8))
            saved.finishWrite(output)
        } catch (error: Exception) { saved.failWrite(output); throw error }
        manager.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<EventDeliveryWorker>(15, TimeUnit.MINUTES).build()).result.get(15, TimeUnit.SECONDS)
        manager.enqueueUniqueWork(IMMEDIATE, ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<EventDeliveryWorker>().build()).result.get(15, TimeUnit.SECONDS)
    }
    fun retainResults(context: Context, scope: ResultDeliveryScope, targets: JSONArray) {
        if (targets.length() == 0) return
        require(targets.length() <= 2)
        for (index in 0 until targets.length()) {
            ResultDelivery.configure(context, ResultDeliveryConfigurationArgs().apply {
                databasePath = scope.databasePath; hostId = scope.hostId; targetJson = targets.getJSONObject(index).toString()
            })
        }
        check(NativeEventSender.acknowledge(scope.databasePath, File(context.applicationInfo.dataDir).canonicalPath,
            scope.hostId, targets.toString())) { "Original result receive handoff remains retained for retry" }
    }
}

internal object NativeEventSender {
    init { System.loadLibrary("xgent_lib") }
    external fun sync(databasePath: String, privateRoot: String, hostId: String, events: String, worker: EventDeliveryWorker): String?
    external fun healthScopes(databasePath: String, privateRoot: String, hostId: String, events: String): String?
    external fun acknowledge(databasePath: String, privateRoot: String, hostId: String, targets: String): Boolean
}
