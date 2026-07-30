package com.ohi.xagent.mobileexecution

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

internal data class AndroidRunRequest(
    val runId: String,
    val workdir: String,
    val command: String,
    val cwd: String,
    val timeoutMs: Long,
    val stdin: ByteArray?,
)

internal data class AndroidRunResult(
    val exitCode: Int,
    val stdout: String,
    val stderr: String,
    val stdoutTruncated: Boolean,
    val stderrTruncated: Boolean,
    val timedOut: Boolean,
    val cancelled: Boolean,
    val effectiveTimeoutMs: Long,
    val durationMs: Long,
)

internal data class ProotBinaries(
    val executable: File,
    val loader: File,
    val talloc: File,
    val androidShmem: File,
) {
    val available: Boolean
        get() = executable.isFile && loader.isFile && talloc.isFile && androidShmem.isFile

    companion object {
        fun resolve(nativeLibraryDir: File): ProotBinaries = ProotBinaries(
            executable = File(nativeLibraryDir, "libxagent_proot.so"),
            loader = File(nativeLibraryDir, "libxagent_proot_loader.so"),
            talloc = File(nativeLibraryDir, "libtalloc.so"),
            androidShmem = File(nativeLibraryDir, "libandroid-shmem.so"),
        )
    }
}

internal class ProotRunner(
    nativeLibraryDir: File,
    nativeRuntimeDir: File,
    private val rootfsDir: File,
    private val tempDir: File,
    private val allowedHostRoots: () -> List<File>,
    private val activeProcesses: ConcurrentHashMap<String, Process>,
    private val cancelledRuns: MutableSet<String>,
) {
    private val nativeLibraryDir = nativeLibraryDir.canonicalFile
    private val binaries = ProotBinaries.resolve(nativeLibraryDir)
    private val nativeRuntimeDir = nativeRuntimeDir.canonicalFile

    fun execute(request: AndroidRunRequest): AndroidRunResult {
        require(binaries.available) { "PRoot binaries are unavailable for this Android ABI" }
        require(File(rootfsDir, "bin/sh").isFile) { "Alpine rootfs is not installed" }
        val runtimeTalloc = prepareNativeRuntime()

        val workdir = File(request.workdir).canonicalFile
        require(workdir.isDirectory) { "workdir must be an existing directory" }
        require(isAllowedHostPath(workdir)) {
            "workdir must be inside XAgent storage or a mounted external workspace"
        }
        val resolvedCwd = resolveCwd(request.cwd, workdir)

        tempDir.mkdirs()
        RootfsEnvironment.prepare(rootfsDir)
        File(rootfsDir, WORKSPACE_PATH.trimStart('/')).mkdirs()
        if (resolvedCwd.externalBind != null) {
            File(rootfsDir, EXTERNAL_CWD_PATH.trimStart('/')).mkdirs()
        }
        val process = ProcessBuilder(buildCommand(request, workdir, resolvedCwd))
            .directory(workdir)
            .redirectErrorStream(false)
            .apply {
                environment().clear()
                environment()["PROOT_LOADER"] = binaries.loader.absolutePath
                environment()["PROOT_TMP_DIR"] = tempDir.absolutePath
                environment()["TMPDIR"] = tempDir.absolutePath
                environment()["LD_LIBRARY_PATH"] = listOf(
                    runtimeTalloc.parentFile!!.absolutePath,
                    nativeLibraryDir.absolutePath,
                ).joinToString(File.pathSeparator)
            }
            .start()

        activeProcesses[request.runId] = process
        if (cancelledRuns.contains(request.runId)) {
            process.destroyForcibly()
        }

        val stdout = BoundedStreamCollector(process.inputStream)
        val stderr = BoundedStreamCollector(process.errorStream)
        val stdinWriter = request.stdin?.let { bytes ->
            thread(name = "xagent-proot-stdin", isDaemon = true) {
                runCatching {
                    process.outputStream.use { stream ->
                        stream.write(bytes)
                        stream.flush()
                    }
                }
            }
        } ?: run {
            process.outputStream.close()
            null
        }

        val startedAt = System.nanoTime()
        val finished = process.waitFor(request.timeoutMs, TimeUnit.MILLISECONDS)
        val timedOut = !finished && !cancelledRuns.contains(request.runId)
        if (!finished) {
            process.destroy()
            if (!process.waitFor(TERMINATION_GRACE_MS, TimeUnit.MILLISECONDS)) {
                process.destroyForcibly()
                process.waitFor(TERMINATION_GRACE_MS, TimeUnit.MILLISECONDS)
            }
        }

        stdinWriter?.join(STREAM_JOIN_MS)
        stdout.join(STREAM_JOIN_MS)
        stderr.join(STREAM_JOIN_MS)
        val durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)

        return AndroidRunResult(
            exitCode = if (process.isAlive) -1 else runCatching { process.exitValue() }.getOrDefault(-1),
            stdout = stdout.text(),
            stderr = stderr.text(),
            stdoutTruncated = stdout.truncated,
            stderrTruncated = stderr.truncated,
            timedOut = timedOut,
            cancelled = cancelledRuns.contains(request.runId),
            effectiveTimeoutMs = request.timeoutMs,
            durationMs = durationMs,
        )
    }

    /**
     * Android's APK native-library extractor only accepts names ending in
     * `.so`, while the unmodified Termux PRoot executable requests the
     * versioned SONAME `libtalloc.so.2`. Keep the official ELF untouched and
     * materialize that versioned filename in the app's private code cache.
     */
    private fun prepareNativeRuntime(): File {
        nativeRuntimeDir.mkdirs()
        require(nativeRuntimeDir.isDirectory) { "could not create the native runtime directory" }
        val target = File(nativeRuntimeDir, "libtalloc.so.2")
        val temporary = File(nativeRuntimeDir, "libtalloc.so.2.tmp")
        temporary.delete()
        binaries.talloc.copyTo(temporary, overwrite = true)
        require(temporary.canRead()) { "the private libtalloc runtime is unreadable" }
        runCatching {
            Files.move(
                temporary.toPath(),
                target.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        }.recoverCatching {
            Files.move(
                temporary.toPath(),
                target.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
            )
        }.getOrElse { error ->
            throw IllegalStateException("could not activate the private libtalloc runtime", error)
        }
        return target
    }

    private fun buildCommand(
        request: AndroidRunRequest,
        workdir: File,
        cwd: ResolvedCwd,
    ): List<String> {
        val command = mutableListOf(
            binaries.executable.absolutePath,
            "--root-id",
            "--link2symlink",
            "--kill-on-exit",
            "-r",
            rootfsDir.absolutePath,
            "-w",
            cwd.guestPath,
            "-b",
            "${workdir.absolutePath}:$WORKSPACE_PATH",
        )
        cwd.externalBind?.let { hostPath ->
            command += "-b"
            command += "${hostPath.absolutePath}:$EXTERNAL_CWD_PATH"
        }
        listOf("/dev", "/proc", "/sys").forEach { hostPath ->
            if (File(hostPath).exists()) {
                command += "-b"
                command += hostPath
            }
        }
        command += listOf(
            "/usr/bin/env",
            "-i",
            "HOME=/root",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "TERM=xterm-256color",
            "LANG=C.UTF-8",
            "LC_ALL=C.UTF-8",
            "/bin/sh",
            "-c",
            "cd -- \"\$1\" && exec /bin/sh -c \"\$2\"",
            "xagent",
            cwd.guestPath,
            request.command,
        )
        return command
    }

    private fun resolveCwd(raw: String, workdir: File): ResolvedCwd {
        val value = raw.trim()
        require(!value.contains('\u0000') && !value.contains('\\')) {
            "cwd contains an invalid character"
        }
        if (value.startsWith('/')) {
            val target = File(value).canonicalFile
            require(target.isDirectory) { "cwd must be an existing directory" }
            require(isAllowedHostPath(target)) {
                "absolute cwd must be inside XAgent storage or a mounted external workspace"
            }
            if (target.isWithin(workdir)) {
                val relative = workdir.toPath().relativize(target.toPath()).toString()
                    .replace(File.separatorChar, '/')
                val guest = if (relative.isEmpty()) WORKSPACE_PATH else "$WORKSPACE_PATH/$relative"
                return ResolvedCwd(guestPath = guest, externalBind = null)
            }
            return ResolvedCwd(guestPath = EXTERNAL_CWD_PATH, externalBind = target)
        }

        val relative = normalizeRelativeCwd(value)
        val target = if (relative.isEmpty()) workdir else File(workdir, relative).canonicalFile
        require(target.isDirectory && target.isWithin(workdir)) {
            "cwd must be an existing directory inside workdir"
        }
        val guest = if (relative.isEmpty()) WORKSPACE_PATH else "$WORKSPACE_PATH/$relative"
        return ResolvedCwd(guestPath = guest, externalBind = null)
    }

    private fun isAllowedHostPath(path: File): Boolean {
        val canonical = path.canonicalFile
        return allowedHostRoots().any { root ->
            runCatching { canonical.isWithin(root.canonicalFile) }.getOrDefault(false)
        }
    }

    private fun normalizeRelativeCwd(raw: String): String {
        val normalized = raw.replace('\\', '/').trim().trim('/')
        if (normalized.isEmpty() || normalized == ".") return ""
        require(!normalized.contains('\u0000')) { "cwd contains an invalid character" }
        require(normalized.split('/').none { it.isEmpty() || it == "." || it == ".." }) {
            "cwd must be a normalized relative path"
        }
        require(!normalized.contains(':')) { "cwd contains an invalid path prefix" }
        return normalized
    }

    private fun File.isWithin(root: File): Boolean {
        val rootPath = root.canonicalFile.toPath()
        return canonicalFile.toPath().startsWith(rootPath)
    }

    companion object {
        private const val WORKSPACE_PATH = "/workspace"
        private const val EXTERNAL_CWD_PATH = "/xagent-cwd"
        private const val TERMINATION_GRACE_MS = 300L
        private const val STREAM_JOIN_MS = 1_000L
    }
}

private data class ResolvedCwd(
    val guestPath: String,
    val externalBind: File?,
)

private class BoundedStreamCollector(
    stream: InputStream,
    private val limit: Int = 400 * 1024,
) {
    private val bytes = ByteArrayOutputStream(minOf(limit, 16 * 1024))

    @Volatile
    var truncated: Boolean = false
        private set

    private val reader = thread(name = "xagent-proot-output", isDaemon = true) {
        stream.use { input ->
            val buffer = ByteArray(8 * 1024)
            while (true) {
                val count = runCatching { input.read(buffer) }.getOrDefault(-1)
                if (count < 0) break
                synchronized(bytes) {
                    val remaining = limit - bytes.size()
                    if (remaining > 0) bytes.write(buffer, 0, minOf(remaining, count))
                    if (count > remaining) truncated = true
                }
            }
        }
    }

    fun join(timeoutMs: Long) = reader.join(timeoutMs)

    fun text(): String = synchronized(bytes) { bytes.toString(Charsets.UTF_8.name()) }
}
