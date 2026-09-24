package com.ohi.xgent.mobileassistant

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.json.JSONArray
import org.json.JSONObject

@InvokeArg
class PhotoListArgs { var startMs: Long? = null; var endMs: Long? = null; var limit: Int = 50 }
@InvokeArg
class PhotoReadArgs { var id: String = "" }

class PhotoLibrary(private val context: Context) {
    private fun granted(permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    fun fullAccess() = granted(if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE)
    fun hasAccess() = fullAccess() || (Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED))
    private fun requireAccess() { check(hasAccess()) { "Photo library permission is required" } }

    fun list(invoke: Invoke) {
        Thread {
            runCatching {
                val args = invoke.parseArgs(PhotoListArgs::class.java)
                requireAccess()
                val start = args.startMs
                val end = args.endMs
                require(start == null || end == null || end > start) { "Photo range end must be after start" }
                val limit = args.limit.coerceIn(1, 200)
                val conditions = mutableListOf<String>()
                val values = mutableListOf<String>()
                if (start != null) { conditions.add("${MediaStore.Images.Media.DATE_TAKEN} >= ?"); values.add(start.toString()) }
                if (end != null) { conditions.add("${MediaStore.Images.Media.DATE_TAKEN} < ?"); values.add(end.toString()) }
                val photos = JSONArray()
                var truncated = false
                val projection = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.WIDTH, MediaStore.Images.Media.HEIGHT)
                val cursor = context.contentResolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection,
                    conditions.takeIf { it.isNotEmpty() }?.joinToString(" AND "), values.takeIf { it.isNotEmpty() }?.toTypedArray(),
                    "${MediaStore.Images.Media.DATE_TAKEN} DESC, ${MediaStore.Images.Media._ID} DESC")
                    ?: error("Photo library query is unavailable")
                cursor.use {
                    while (it.moveToNext()) {
                        if (photos.length() == limit) { truncated = true; break }
                        photos.put(JSObject().apply {
                            put("id", it.getLong(0).toString())
                            put("createdMs", if (it.isNull(1) || it.getLong(1) <= 0) JSONObject.NULL else it.getLong(1))
                            put("width", it.getInt(2).coerceAtLeast(0)); put("height", it.getInt(3).coerceAtLeast(0))
                        })
                    }
                }
                JSObject().apply { put("photos", photos); put("truncated", truncated); put("accessLimited", !fullAccess()) }
            }.onSuccess(invoke::resolve).onFailure { invoke.reject("Photo query failed: ${it.message}") }
        }.start()
    }

    fun read(invoke: Invoke) {
        Thread {
            runCatching {
                val args = invoke.parseArgs(PhotoReadArgs::class.java)
                requireAccess()
                val id = args.id.toLongOrNull()?.takeIf { it >= 0 } ?: error("Invalid photo identifier")
                val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
                val bitmap = if (Build.VERSION.SDK_INT >= 29) {
                    context.contentResolver.loadThumbnail(uri, Size(2048, 2048), null)
                } else {
                    val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
                        val output = ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            check(output.size() + count <= 20 * 1024 * 1024) { "Photo exceeds the 20 MB decoder limit" }
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    } ?: error("Photo is unavailable or not authorized")
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Unsupported photo format" }
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2048) sample *= 2
                    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                        ?: error("Unable to decode photo")
                    val orientation = ByteArrayInputStream(bytes).use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
                    val matrix = Matrix()
                    when (orientation) {
                        2 -> matrix.setScale(-1f, 1f)
                        3 -> matrix.setRotate(180f)
                        4 -> matrix.setScale(1f, -1f)
                        5 -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
                        6 -> matrix.setRotate(90f)
                        7 -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
                        8 -> matrix.setRotate(-90f)
                    }
                    Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also { if (it !== decoded) decoded.recycle() }
                }
                try {
                    val output = ByteArrayOutputStream()
                    check(bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output)) { "Unable to encode photo preview" }
                    check(output.size() <= 10 * 1024 * 1024) { "Photo preview exceeds the 10 MB limit" }
                    JSObject().apply {
                        put("id", args.id); put("mimeType", "image/jpeg")
                        put("dataBase64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
                        put("width", bitmap.width); put("height", bitmap.height)
                    }
                } finally { bitmap.recycle() }
            }.onSuccess(invoke::resolve).onFailure { invoke.reject("Photo read failed: ${it.message}") }
        }.start()
    }
}
