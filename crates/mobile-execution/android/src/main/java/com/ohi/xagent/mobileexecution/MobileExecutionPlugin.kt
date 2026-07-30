package com.ohi.xagent.mobileexecution

import android.app.Activity
import android.content.Intent
import android.util.Base64
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import org.json.JSONArray

@InvokeArg
class InstallArgs

@InvokeArg
class InstallToolchainsArgs {
    var runId: String? = null
    var toolchains: Array<String>? = null
    var timeoutMs: Long? = null
}

@InvokeArg
class WasiArgs {
    var modulePath: String? = null
    var arguments: Array<String>? = null
}

@InvokeArg
class RunArgs {
    var runId: String? = null
    var workdir: String? = null
    var command: String? = null
    var cwd: String? = null
    var timeoutMs: Long? = null
    var stdinBase64: String? = null
    var wasi: WasiArgs? = null
}

@InvokeArg
class CancelArgs {
    var runId: String? = null
}

@InvokeArg
class PickExternalWorkspaceArgs {
    var allowWrite: Boolean? = true
}

@InvokeArg
class RemoveExternalWorkspaceArgs {
    var id: String? = null
}

@TauriPlugin
class MobileExecutionPlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor { task ->
        Thread(task, "xagent-mobile-execution").apply { isDaemon = true }
    }
    private val activeProcesses = ConcurrentHashMap<String, Process>()
    private val scheduledRuns = ConcurrentHashMap.newKeySet<String>()
    private val cancelledRuns = ConcurrentHashMap.newKeySet<String>()

    private val backendDir = File(activity.filesDir, "mobile-execution")
    private val rootfsDir = File(backendDir, "rootfs")
    private val installer = RootfsInstaller(activity.assets, backendDir, rootfsDir)
    private val inventory = MobileEnvironmentInventory(backendDir, rootfsDir)
    private val externalWorkspaces = ExternalWorkspaceStore(activity)
    private val runner by lazy {
        ProotRunner(
            nativeLibraryDir = File(activity.applicationInfo.nativeLibraryDir),
            nativeRuntimeDir = File(activity.codeCacheDir, "xagent-native-runtime"),
            rootfsDir = rootfsDir,
            tempDir = File(activity.cacheDir, "xagent-proot"),
            allowedHostRoots = {
                listOf(activity.filesDir) + externalWorkspaces.allowedRoots()
            },
            activeProcesses = activeProcesses,
            cancelledRuns = cancelledRuns,
        )
    }

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(statusPayload())
    }

    @Command
    fun install(invoke: Invoke) {
        runCatching { invoke.parseArgs(InstallArgs::class.java) }
            .getOrElse { error ->
                invoke.reject("Invalid rootfs install request: ${error.message}")
                return
            }
        worker.execute {
            runCatching { installer.install() }
                .onSuccess { rootfs ->
                    refreshInventoryBestEffort()
                    invoke.resolve(
                        JSObject().apply {
                            put("backend", BACKEND)
                            put("installed", true)
                            put(
                                "detail",
                                "${rootfs.distribution} ${rootfs.version} rootfs installed and verified",
                            )
                        },
                    )
                }
                .onFailure { error ->
                    invoke.reject("Rootfs installation failed: ${error.message}")
                }
        }
    }

    @Command
    fun installToolchains(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(InstallToolchainsArgs::class.java) }
            .getOrElse { error ->
                invoke.reject("Invalid toolchain install request: ${error.message}")
                return
            }
        val runId = runCatching { requireRunId(args.runId) }
            .getOrElse { error ->
                invoke.reject(error.message ?: "Invalid runId")
                return
            }
        val requested = runCatching {
            MobileToolchains.resolve(args.toolchains?.toList().orEmpty())
        }.getOrElse { error ->
            invoke.reject(error.message ?: "Invalid toolchain selection")
            return
        }
        val timeoutMs = (args.timeoutMs ?: TOOLCHAIN_INSTALL_TIMEOUT_MS)
            .coerceIn(MIN_TIMEOUT_MS, MAX_TOOLCHAIN_INSTALL_TIMEOUT_MS)
        if (!File(rootfsDir, "sbin/apk").isFile) {
            invoke.reject("Install the bundled Alpine rootfs before adding toolchains")
            return
        }
        if (!scheduledRuns.add(runId)) {
            invoke.reject("A mobile run with this runId already exists")
            return
        }

        worker.execute {
            try {
                if (cancelledRuns.contains(runId)) {
                    invoke.resolve(toolchainPayload(requested, null, cancelled = true))
                    return@execute
                }
                val workspace = File(backendDir, "package-workspace").apply { mkdirs() }
                val result = runner.execute(
                    AndroidRunRequest(
                        runId = runId,
                        workdir = workspace.absolutePath,
                        command = MobileToolchains.installCommand(requested),
                        cwd = "",
                        timeoutMs = timeoutMs,
                        stdin = null,
                    ),
                )
                if (result.exitCode == 0 && !result.timedOut && !result.cancelled) {
                    refreshInventoryBestEffort()
                }
                invoke.resolve(toolchainPayload(requested, result, cancelled = result.cancelled))
            } catch (error: Exception) {
                invoke.reject("Toolchain installation failed: ${error.message}")
            } finally {
                activeProcesses.remove(runId)
                scheduledRuns.remove(runId)
                cancelledRuns.remove(runId)
            }
        }
    }

    @Command
    fun listExternalWorkspaces(invoke: Invoke) {
        invoke.resolve(externalWorkspaces.payload())
    }

    @Command
    fun pickExternalWorkspace(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(PickExternalWorkspaceArgs::class.java) }
            .getOrElse { error ->
                invoke.reject("Invalid external workspace request: ${error.message}")
                return
            }
        if (!WorkspacePickerCoordinator.begin { uri, error ->
                when {
                    error != null -> invoke.reject(error)
                    uri == null -> invoke.reject("Workspace selection was cancelled")
                    else -> worker.execute {
                        runCatching {
                            externalWorkspaces.add(uri, args.allowWrite != false)
                        }.onSuccess { entry ->
                            invoke.resolve(externalWorkspaces.payload(entry))
                        }.onFailure { cause ->
                            invoke.reject(cause.message ?: "Could not mount the selected workspace")
                        }
                    }
                }
            }
        ) {
            invoke.reject("Another workspace picker is already open")
            return
        }
        activity.startActivity(Intent(activity, WorkspacePickerActivity::class.java))
    }

    @Command
    fun removeExternalWorkspace(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(RemoveExternalWorkspaceArgs::class.java) }
            .getOrElse { error ->
                invoke.reject("Invalid external workspace removal request: ${error.message}")
                return
            }
        val id = args.id?.trim().orEmpty()
        if (id.isEmpty()) {
            invoke.reject("External workspace id is required")
            return
        }
        invoke.resolve(JSObject().apply { put("removed", externalWorkspaces.remove(id)) })
    }

    @Command
    fun run(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(RunArgs::class.java) }
            .getOrElse { error ->
                invoke.reject("Invalid mobile run request: ${error.message}")
                return
            }
        if (args.wasi != null) {
            invoke.reject("WASI modules are supported by the iOS a-Shell backend, not Android PRoot")
            return
        }

        val request = runCatching { args.toRequest() }
            .getOrElse { error ->
                invoke.reject("Invalid mobile run request: ${error.message}")
                return
            }

        if (!scheduledRuns.add(request.runId)) {
            invoke.reject("A mobile run with this runId already exists")
            return
        }

        worker.execute {
            try {
                if (cancelledRuns.contains(request.runId)) {
                    invoke.resolve(cancelledPayload(request))
                    return@execute
                }
                invoke.resolve(runner.execute(request).toPayload())
            } catch (error: Exception) {
                invoke.reject("Mobile command failed: ${error.message}")
            } finally {
                activeProcesses.remove(request.runId)
                scheduledRuns.remove(request.runId)
                cancelledRuns.remove(request.runId)
            }
        }
    }

    @Command
    fun cancel(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(CancelArgs::class.java) }
            .getOrElse { error ->
                invoke.reject("Invalid cancel request: ${error.message}")
                return
            }
        val runId = runCatching { requireRunId(args.runId) }
            .getOrElse { error ->
                invoke.reject(error.message ?: "Invalid runId")
                return
            }
        val scheduled = scheduledRuns.contains(runId)
        if (scheduled) {
            cancelledRuns.add(runId)
            activeProcesses[runId]?.let { process ->
                process.destroy()
                if (process.isAlive) process.destroyForcibly()
            }
        }
        invoke.resolve(JSObject().apply { put("cancelled", scheduled) })
    }

    private fun statusPayload(): JSObject {
        val binaries = ProotBinaries.resolve(File(activity.applicationInfo.nativeLibraryDir))
        val installed = File(rootfsDir, "bin/sh").isFile
        val bundledRootfs = installer.bundledRootfsStatus()
        val available = binaries.available && (installed || bundledRootfs.isSuccess)
        val detail = when {
            !binaries.available -> "PRoot binaries are not bundled for ${android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "this ABI"}"
            !installed && bundledRootfs.isFailure ->
                "The verified Alpine rootfs is missing from this application build"
            !installed -> "PRoot is available; install the verified Alpine rootfs to enable local execution"
            else -> "Android PRoot execution is ready"
        }
        return JSObject().apply {
            put("backend", BACKEND)
            put("available", available)
            put("installed", installed)
            put("detail", detail)
            put(
                "capabilities",
                JSObject().apply {
                    put("shell", available && installed)
                    put("wasi", false)
                    put("network", available && installed)
                    put("childProcesses", available && installed)
                    put("userSelectedWorkspaces", true)
                    put("packageManagement", available && installed)
                },
            )
            put("toolchains", toolchainStatusPayload())
            put(
                "environmentVersion",
                File(rootfsDir, "etc/xagent-environment")
                    .takeIf { it.isFile }
                    ?.readText()
                    ?.trim()
                    ?.takeIf { it.isNotEmpty() },
            )
            put("diskUsageBytes", inventory.snapshot()?.diskUsageBytes)
        }
    }

    private fun toolchainPayload(
        requested: List<MobileToolchainDefinition>,
        result: AndroidRunResult?,
        cancelled: Boolean,
    ): JSObject = JSObject().apply {
        val states = MobileToolchains.inspect(rootfsDir)
        val installedIds = states
            .filter { state ->
                state.installed && requested.any { definition -> definition.id == state.definition.id }
            }
            .map { it.definition.id }
        val succeeded = result != null && result.exitCode == 0 &&
            !result.timedOut && !cancelled && installedIds.size == requested.size
        put("backend", BACKEND)
        put("succeeded", succeeded)
        put("exitCode", result?.exitCode ?: -1)
        put("installed", JSONArray(installedIds))
        put("status", toolchainStatusPayload(states))
        put("stdout", result?.stdout.orEmpty())
        put("stderr", result?.stderr.orEmpty())
        put("timedOut", result?.timedOut ?: false)
        put("cancelled", cancelled)
    }

    private fun toolchainStatusPayload(
        states: List<MobileToolchainState> = MobileToolchains.inspect(rootfsDir),
    ): JSONArray = JSONArray().apply {
        states.forEach { state ->
            put(
                JSObject().apply {
                    put("id", state.definition.id)
                    put("label", state.definition.label)
                    put("installed", state.installed)
                    put("installable", File(rootfsDir, "sbin/apk").isFile)
                    put("version", state.version)
                    put("detail", state.definition.detail)
                },
            )
        }
    }

    private fun RunArgs.toRequest(): AndroidRunRequest {
        val decodedStdin = stdinBase64?.takeIf { it.isNotBlank() }?.let { encoded ->
            Base64.decode(encoded, Base64.DEFAULT).also {
                require(it.size <= MAX_STDIN_BYTES) { "stdin exceeds $MAX_STDIN_BYTES bytes" }
            }
        }
        return AndroidRunRequest(
            runId = requireRunId(runId),
            workdir = workdir?.trim().orEmpty(),
            command = command?.trim().orEmpty(),
            cwd = cwd?.trim().orEmpty(),
            timeoutMs = (timeoutMs ?: DEFAULT_TIMEOUT_MS).coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
            stdin = decodedStdin,
        ).also { request ->
            require(request.workdir.isNotBlank()) { "workdir is required" }
            require(request.command.isNotBlank()) { "command is required" }
            require(request.command.length <= MAX_COMMAND_CHARS) {
                "command exceeds $MAX_COMMAND_CHARS characters"
            }
        }
    }

    private fun requireRunId(value: String?): String {
        val runId = value?.trim().orEmpty()
        require(runId.matches(RUN_ID_PATTERN)) {
            "runId must contain 1-128 letters, digits, dots, underscores, or hyphens"
        }
        return runId
    }

    private fun refreshInventoryBestEffort() {
        runCatching { inventory.refresh() }
            .onFailure { error ->
                Log.w(TAG, "Could not refresh the rootfs disk inventory", error)
            }
    }

    private fun cancelledPayload(request: AndroidRunRequest): JSObject =
        AndroidRunResult(
            exitCode = -1,
            stdout = "",
            stderr = "",
            stdoutTruncated = false,
            stderrTruncated = false,
            timedOut = false,
            cancelled = true,
            effectiveTimeoutMs = request.timeoutMs,
            durationMs = 0,
        ).toPayload()

    private fun AndroidRunResult.toPayload(): JSObject = JSObject().apply {
        put("exitCode", exitCode)
        put("backend", BACKEND)
        put("shell", "sh")
        put("platform", "android")
        put("profile", "android-proot-alpine")
        put("shellFamily", "posix")
        put("stdout", stdout)
        put("stderr", stderr)
        put("stdoutTruncated", stdoutTruncated)
        put("stderrTruncated", stderrTruncated)
        put("timedOut", timedOut)
        put("cancelled", cancelled)
        put("stdioOpenAfterExit", false)
        put("effectiveTimeoutMs", effectiveTimeoutMs)
        put("durationMs", durationMs)
    }

    companion object {
        private const val TAG = "XAgentMobileExecution"
        private const val BACKEND = "android-proot"
        private const val DEFAULT_TIMEOUT_MS = 120_000L
        private const val MIN_TIMEOUT_MS = 1_000L
        private const val MAX_TIMEOUT_MS = 600_000L
        private const val TOOLCHAIN_INSTALL_TIMEOUT_MS = 600_000L
        private const val MAX_TOOLCHAIN_INSTALL_TIMEOUT_MS = 1_800_000L
        private const val MAX_STDIN_BYTES = 1024 * 1024
        private const val MAX_COMMAND_CHARS = 256 * 1024
        private val RUN_ID_PATTERN = Regex("[A-Za-z0-9._-]{1,128}")
    }
}
