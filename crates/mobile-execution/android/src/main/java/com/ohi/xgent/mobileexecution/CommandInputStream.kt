package com.ohi.xgent.mobileexecution

import java.io.OutputStream
import java.util.concurrent.Executors

/** Serial, bounded stdin delivery; command exit/cancellation closes its pipe. */
internal class CommandInputStream(
    private val stream: OutputStream,
    private val onClosed: (String?) -> Unit,
) {
    private val lock = Any()
    private val writer = Executors.newSingleThreadExecutor { task ->
        Thread(task, "xgent-command-input").apply { isDaemon = true }
    }
    private var queuedBytes = 0
    private var eofRequested = false
    private var closed = false

    fun enqueue(bytes: ByteArray, eof: Boolean) = synchronized(lock) {
        require(bytes.size <= 16 * 1024 && (bytes.isNotEmpty() || eof)) {
            "Input must contain 1–16384 bytes or EOF"
        }
        check(!closed && !eofRequested) { "Command input is closed" }
        check(queuedBytes + bytes.size <= 64 * 1024) { "Command input is full; wait and retry" }
        queuedBytes += bytes.size
        eofRequested = eof
        writer.execute {
            try {
                if (synchronized(lock) { closed }) return@execute
                stream.write(bytes)
                stream.flush()
                if (eof) close()
            } catch (error: Exception) {
                close(error.message ?: "Command input failed")
            } finally {
                synchronized(lock) { queuedBytes -= bytes.size }
            }
        }
    }

    fun close(error: String? = null) {
        val firstClose = synchronized(lock) {
            if (closed) false else { closed = true; true }
        }
        if (!firstClose) return
        runCatching { stream.close() }
        writer.shutdown()
        onClosed(error)
    }
}
