package com.ohi.xgent.mobileassistant

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** OS-readable storage contains only accepted task read capabilities. The key
 * stays in AndroidKeyStore; ciphertext and atomic backups stay out of backups. */
internal object RemoteResultDelivery {
    private const val KEY = "xgent.result.read.v1"
    private const val MAX_BYTES = 2 * 1024 * 1024
    private val lock = Any()
    private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "xgent-result-read-v1.enc"))
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(KEY, null)
        if (existing != null) return existing as SecretKey
        check(create) { "Original result read key is unavailable" }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setUserAuthenticationRequired(false).build())
        return generator.generateKey()
    }
    private fun aad(scope: ResultDeliveryScope) = "xgent.result.read.v1\u0000${scope.hostId}\u0000${scope.databasePath}".toByteArray(Charsets.UTF_8)
    private fun read(context: Context, scope: ResultDeliveryScope): JSONArray {
        val saved = file(context)
        if (!saved.baseFile.exists() && !File(saved.baseFile.path + ".bak").exists()) return JSONArray()
        val bytes = saved.openRead().use { stream ->
            val buffer = ByteArray(MAX_BYTES + 1)
            var count = 0
            while (count < buffer.size) {
                val next = stream.read(buffer, count, buffer.size - count)
                if (next < 0) break
                count += next
            }
            require(count in 1..MAX_BYTES) { "Retained result read configuration exceeds limits" }
            buffer.copyOf(count)
        }
        val value = JSONObject(bytes.toString(Charsets.UTF_8))
        require(value.length() == 3 && value.getInt("version") == 1)
        val nonce = Base64.decode(value.getString("nonce"), Base64.NO_WRAP)
        require(nonce.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad(scope))
        val plaintext = cipher.doFinal(Base64.decode(value.getString("ciphertext"), Base64.NO_WRAP))
        require(plaintext.size <= MAX_BYTES)
        return JSONArray(plaintext.toString(Charsets.UTF_8)).also { require(it.length() <= 128) }
    }
    private fun write(context: Context, scope: ResultDeliveryScope, targets: JSONArray) {
        val plaintext = targets.toString().toByteArray(Charsets.UTF_8)
        require(plaintext.size <= MAX_BYTES * 3 / 4 && targets.length() <= 128)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        cipher.updateAAD(aad(scope))
        val bytes = JSONObject().put("version", 1).put("nonce", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(cipher.doFinal(plaintext), Base64.NO_WRAP)).toString().toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_BYTES)
        val saved = file(context)
        val output = saved.startWrite()
        try { output.write(bytes); saved.finishWrite(output) }
        catch (error: Exception) { saved.failWrite(output); throw error }
    }
    fun configure(context: Context, scope: ResultDeliveryScope, update: String) = synchronized(lock) {
        if (update.isEmpty()) return@synchronized
        require(update.toByteArray(Charsets.UTF_8).size <= 16 * 1024)
        val target = JSONObject(update)
        val request = target.getString("requestId")
        val retained = read(context, scope)
        val next = JSONArray()
        // Exact private native bindings are the revocation authority, including
        // peer removal and scopes staged before a lost OS configuration ACK.
        SQLiteDatabase.openDatabase(scope.databasePath, null,
            SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS).use { db ->
            db.rawQuery("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'", null).use { rows ->
                check(rows.moveToFirst() && rows.getString(0) == scope.hostId)
            }
            for (index in 0 until retained.length()) {
                val prior = retained.getJSONObject(index)
                if (prior.getString("requestId") == request) continue
                db.rawQuery("SELECT request_id FROM automation_result_delivery_targets WHERE request_id=?1 AND source_host_id=?2 AND binding_hash IS NOT NULL",
                    arrayOf(prior.getString("requestId"), prior.getString("sourceHostId"))).use { rows ->
                    if (rows.moveToFirst()) next.put(prior)
                }
            }
            db.rawQuery("SELECT request_id FROM automation_result_delivery_targets WHERE request_id=?1 AND source_host_id=?2 AND binding_hash IS NOT NULL",
                arrayOf(request, target.getString("sourceHostId"))).use { rows -> check(rows.moveToFirst()) }
        }
        next.put(target)
        write(context, scope, next)
    }
    fun receive(context: Context, worker: ResultDeliveryWorker): Boolean {
        val scope = ResultDelivery.load(context) ?: return true
        val targets = synchronized(lock) {
            val retained = read(context, scope)
            if (retained.length() == 0) return true
            retained.toString()
        }
        if (worker.isStopped) return false
        // Native code opens the existing DB without CREATE, claims the same
        // durable watches, reads only pinned original grants, and commits via
        // the ordinary Rust inbox validator. No Activity or Tauri runtime.
        return NativeResultReceiver.sync(scope.databasePath, File(context.applicationInfo.dataDir).canonicalPath,
            scope.hostId, targets, worker)
    }
}

internal object NativeResultReceiver {
    init { System.loadLibrary("xgent_lib") }
    external fun sync(databasePath: String, privateRoot: String, hostId: String, targets: String, worker: ResultDeliveryWorker): Boolean
}
