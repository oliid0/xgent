package com.ohi.xgent.mobileassistant

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.os.Build
import android.util.Base64
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

@InvokeArg
class ImageAttachmentArgs { var fileName: String = ""; var contentBase64: String = "" }

internal object ImageAttachmentPreparer {
    private const val MAX_INPUT_BYTES = 32 * 1024 * 1024
    private const val MAX_OUTPUT_BYTES = 5 * 1024 * 1024
    private const val MAX_EDGE = 2048
    private val extensions = mapOf(
        "image/png" to "png", "image/jpeg" to "jpg", "image/gif" to "gif",
        "image/webp" to "webp", "image/avif" to "avif", "image/bmp" to "bmp",
        "image/x-icon" to "ico",
    )

    fun run(invoke: Invoke) {
        Thread {
            runCatching {
                val args = invoke.parseArgs(ImageAttachmentArgs::class.java)
                prepare(args.fileName, args.contentBase64)
            }.onSuccess(invoke::resolve).onFailure { invoke.reject("Image preparation failed: ${it.message}") }
        }.start()
    }

    fun prepare(fileName: String, contentBase64: String): JSObject {
        require(contentBase64.isNotEmpty() && contentBase64.length <= ((MAX_INPUT_BYTES + 2) / 3) * 4) {
            "Photo exceeds the 32 MB import limit or is empty"
        }
        val bytes = Base64.decode(contentBase64, Base64.NO_WRAP)
        require(bytes.isNotEmpty() && bytes.size <= MAX_INPUT_BYTES) { "Photo exceeds the 32 MB import limit" }
        // Header-only detection avoids decoding an already supported photo at full resolution.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val detected = when (bounds.outMimeType) {
            "image/x-ms-bmp" -> "image/bmp"
            "image/vnd.microsoft.icon" -> "image/x-icon"
            else -> bounds.outMimeType
        }
        if (bounds.outWidth > 0 && bounds.outHeight > 0 && detected in extensions && bytes.size <= MAX_OUTPUT_BYTES) {
            return result(fileName, detected!!, bytes)
        }

        var bitmap = decode(bytes, bounds)
        try {
            val mimeType = if (bitmap.hasAlpha()) "image/png" else "image/jpeg"
            val format = if (mimeType == "image/png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
            while (true) {
                val output = ByteArrayOutputStream()
                check(bitmap.compress(format, 85, output)) { "Unable to encode photo" }
                if (output.size() <= MAX_OUTPUT_BYTES) return result(fileName, mimeType, output.toByteArray())
                check(maxOf(bitmap.width, bitmap.height) > 1) { "Photo exceeds the 5 MB preview limit" }
                val smaller = Bitmap.createScaledBitmap(bitmap, maxOf(1, bitmap.width / 2), maxOf(1, bitmap.height / 2), true)
                if (smaller !== bitmap) bitmap.recycle()
                bitmap = smaller
            }
        } finally { bitmap.recycle() }
    }

    private fun decode(bytes: ByteArray, bounds: BitmapFactory.Options): Bitmap {
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder handles HEIF and EXIF orientation, with sampling before pixel allocation.
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                val width = info.size.width
                val height = info.size.height
                require(width > 0 && height > 0) { "Invalid photo dimensions" }
                val ratio = minOf(1.0, MAX_EDGE.toDouble() / maxOf(width, height))
                decoder.setTargetSize(maxOf(1, (width * ratio).toInt()), maxOf(1, (height * ratio).toInt()))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
            }
        }
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Unsupported photo format on this Android version" }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_EDGE) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: error("Unable to decode photo")
        try {
            val orientation = runCatching {
                ByteArrayInputStream(bytes).use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
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
            return Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also { if (it !== decoded) decoded.recycle() }
        } catch (error: Throwable) {
            decoded.recycle()
            throw error
        }
    }

    private fun result(fileName: String, mimeType: String, bytes: ByteArray): JSObject {
        val basename = fileName.substringAfterLast('/').substringAfterLast('\\')
        val stem = basename.substringBeforeLast('.', basename).ifBlank { "photo" }
        return JSObject().apply {
            put("fileName", "$stem.${extensions.getValue(mimeType)}")
            put("mimeType", mimeType)
            put("contentBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
    }
}
