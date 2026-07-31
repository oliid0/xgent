import Darwin
import Foundation
import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import ios_system

// WasmKit 0.1.6 has no fuel or external interruption API. Keep the runtime
// linked for the verified-extension roadmap, but do not accept arbitrary WASI
// modules until execution can be stopped without killing the application.
private let wasiExecutionAvailable = false

private struct InstallArgs: Decodable {
}

private struct InstallToolchainsArgs: Decodable {
    let runId: String
    let toolchains: [String]
    let timeoutMs: UInt64
}

private struct WasiArgs: Decodable {
    let modulePath: String
    let arguments: [String]
}

private struct RunArgs: Decodable {
    let runId: String
    let workdir: String
    let command: String
    let cwd: String?
    let timeoutMs: UInt64
    let stdinBase64: String?
    let wasi: WasiArgs?
}

private struct CancelArgs: Decodable {
    let runId: String
}

private struct PickExternalWorkspaceArgs: Decodable {
    let allowWrite: Bool?
}

private struct RemoveExternalWorkspaceArgs: Decodable {
    let id: String
}

enum MobileExecutionError: LocalizedError {
    case invalidRequest(String)
    case io(String)

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let message), .io(let message): return message
        }
    }
}

private struct ActiveCommand {
    let runId: String
    let pid: Int32
    var cancelled: Bool
    var timedOut: Bool
}

private struct IOSShellResourceStatus {
    let vim: Bool
    let certificateBundle: Bool
}

private struct IOSToolchain {
    let id: String
    let label: String
    let installed: Bool
    let installable: Bool
    let version: String?
    let detail: String

    var payload: [String: Any] {
        [
            "id": id,
            "label": label,
            "installed": installed,
            "installable": installable,
            "version": version.map { $0 as Any } ?? NSNull(),
            "detail": detail,
        ]
    }
}

private func iosToolchains(
    available: Bool,
    resources: IOSShellResourceStatus
) -> [IOSToolchain] {
    [
        IOSToolchain(
            id: "unix",
            label: "Unix essentials",
            installed: available,
            installable: false,
            version: "ios_system 3.0.2",
            detail: "ls, cp, mv, rm, find, grep, sed, awk, tar, gzip and POSIX shell"
        ),
        IOSToolchain(
            id: "javascript",
            label: "JavaScript",
            installed: available,
            installable: false,
            version: "JavaScriptCore",
            detail: "jsc and jsc_core; this is not Node.js and does not provide npm"
        ),
        IOSToolchain(
            id: "network",
            label: "Network tools",
            installed: available && resources.certificateBundle,
            installable: false,
            version: "curl (ios_system 3.0.2)",
            detail: "curl with a pinned CA bundle plus ssh, scp, and sftp; GNU wget is not bundled"
        ),
        IOSToolchain(
            id: "editor",
            label: "Vim",
            installed: available && resources.vim,
            installable: false,
            version: "a-Shell iOS Vim",
            detail: "Vim with bundled runtime data; agent tasks should use non-interactive ex mode"
        ),
        IOSToolchain(
            id: "git",
            label: "Git operations",
            installed: available,
            installable: false,
            version: "lg2",
            detail: "libgit2-based lg2; its CLI is not fully compatible with desktop git"
        ),
        IOSToolchain(
            id: "media",
            label: "Media tools",
            installed: available,
            installable: false,
            version: "a-Shell FFmpeg",
            detail: "Native ffmpeg and ffprobe command frameworks"
        ),
        IOSToolchain(
            id: "wasi",
            label: "WebAssembly/WASI",
            installed: available && wasiExecutionAvailable,
            installable: false,
            version: "WasmKit 0.1.6",
            detail: "Reserved for verified extensions; arbitrary modules stay disabled until the runtime supports enforceable interruption"
        ),
        IOSToolchain(
            id: "node",
            label: "Node.js and npm",
            installed: false,
            installable: false,
            version: nil,
            detail: "Unavailable on this iOS backend; use JavaScriptCore, a WASI tool, LAN, or cloud execution"
        ),
        IOSToolchain(
            id: "extensions",
            label: "Verified WASI extensions",
            installed: false,
            installable: false,
            version: nil,
            detail: "The signed XAgent extension catalog is not installed in this build yet"
        ),
    ]
}

private func iosToolchainPayload(
    available: Bool,
    resources: IOSShellResourceStatus
) -> [[String: Any]] {
    iosToolchains(available: available, resources: resources).map(\.payload)
}

final class MobileExecutionPlugin: Plugin, UIDocumentPickerDelegate {
    private let executionQueue = DispatchQueue(label: "com.ohi.xagent.mobile-execution")
    private let stateLock = NSLock()
    private let initializationLock = NSLock()
    private var activeCommand: ActiveCommand?
    private var scheduledRuns = Set<String>()
    private var cancelledRuns = Set<String>()
    private var initialized = false
    private let sessionIdentifier = strdup("xagent-mobile-execution")!
    private let externalWorkspaces = IOSExternalWorkspaceStore()
    private var pendingWorkspaceInvoke: Invoke?
    private var pendingWorkspaceAllowWrite = true

    @objc func status(_ invoke: Invoke) {
        let initializationError: Error?
        do {
            try initializeBackendIfNeeded()
            initializationError = nil
        } catch {
            initializationError = error
        }
        let available = initializationError == nil
        let resources = shellResourceStatus()
        invoke.resolve([
            "backend": "ios-a-shell",
            "available": available,
            "installed": available,
            "detail": initializationError?.localizedDescription
                ?? "iOS command frameworks are ready; WasmKit is linked but arbitrary WASI, Node.js/npm, and Linux process APIs remain disabled",
            "capabilities": [
                "shell": available,
                "wasi": available && wasiExecutionAvailable,
                "network": available && resources.certificateBundle,
                "childProcesses": false,
                "userSelectedWorkspaces": true,
                "packageManagement": false,
            ],
            "toolchains": iosToolchainPayload(available: available, resources: resources),
            "environmentVersion": "XAgent iOS shell core 1",
            "diskUsageBytes": NSNull(),
        ])
    }

    @objc func install(_ invoke: Invoke) throws {
        _ = try invoke.parseArgs(InstallArgs.self)
        try initializeBackendIfNeeded()
        invoke.resolve([
            "backend": "ios-a-shell",
            "installed": true,
            "detail": "The iOS execution backend is bundled with XAgent",
        ])
    }

    @objc func installToolchains(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(InstallToolchainsArgs.self)
        try initializeBackendIfNeeded()
        try validateRunId(request.runId)
        guard request.timeoutMs >= 1_000, request.timeoutMs <= 1_800_000 else {
            throw MobileExecutionError.invalidRequest("timeoutMs must be between 1000 and 1800000")
        }
        let resources = shellResourceStatus()
        let catalog = iosToolchains(available: true, resources: resources)
        let byId = Dictionary(uniqueKeysWithValues: catalog.map { ($0.id, $0) })
        let requested = try request.toolchains.map { id -> IOSToolchain in
            guard let toolchain = byId[id] else {
                throw MobileExecutionError.invalidRequest("Unknown iOS capability pack: \(id)")
            }
            return toolchain
        }
        guard !requested.isEmpty else {
            throw MobileExecutionError.invalidRequest("At least one capability pack is required")
        }
        guard requested.allSatisfy(\.installed) else {
            let unavailable = requested.filter { !$0.installed }.map(\.id).joined(separator: ", ")
            throw MobileExecutionError.invalidRequest(
                "These iOS capabilities are not installable in this build: \(unavailable)"
            )
        }
        invoke.resolve([
            "backend": "ios-a-shell",
            "succeeded": true,
            "exitCode": 0,
            "installed": requested.map(\.id),
            "status": catalog.map(\.payload),
            "stdout": "",
            "stderr": "",
            "timedOut": false,
            "cancelled": false,
        ])
    }

    @objc func listExternalWorkspaces(_ invoke: Invoke) {
        // Tauri 2.11's JsonObject overload only accepts an object root. The
        // generic Encodable overload preserves the array response expected by
        // the Rust mobile binding.
        invoke.resolve(externalWorkspaces.listEncodablePayload())
    }

    @objc func pickExternalWorkspace(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(PickExternalWorkspaceArgs.self)
        guard pendingWorkspaceInvoke == nil else {
            throw MobileExecutionError.invalidRequest("Another workspace picker is already open")
        }
        guard let presenter = Self.topViewController() else {
            throw MobileExecutionError.invalidRequest("Could not present the folder picker")
        }
        pendingWorkspaceInvoke = invoke
        pendingWorkspaceAllowWrite = request.allowWrite ?? true
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        picker.allowsMultipleSelection = false
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    @objc func removeExternalWorkspace(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(RemoveExternalWorkspaceArgs.self)
        executionQueue.async { [weak self] in
            guard let self else {
                invoke.reject("The mobile execution backend is unavailable")
                return
            }
            do {
                let removed = try self.externalWorkspaces.remove(id: request.id)
                invoke.resolve(["removed": removed])
            } catch {
                invoke.reject(error.localizedDescription)
            }
        }
    }

    func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard let invoke = pendingWorkspaceInvoke else { return }
        pendingWorkspaceInvoke = nil
        guard let url = urls.first else {
            invoke.reject("Workspace selection was cancelled")
            return
        }
        let allowWrite = pendingWorkspaceAllowWrite
        executionQueue.async { [weak self] in
            guard let self else {
                invoke.reject("The mobile execution backend is unavailable")
                return
            }
            do {
                invoke.resolve(
                    try self.externalWorkspaces.add(
                        url: url,
                        allowWrite: allowWrite
                    )
                )
            } catch {
                invoke.reject(error.localizedDescription)
            }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingWorkspaceInvoke?.reject("Workspace selection was cancelled")
        pendingWorkspaceInvoke = nil
    }

    @objc func run(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(RunArgs.self)
        try validate(request)
        stateLock.lock()
        let inserted = scheduledRuns.insert(request.runId).inserted
        stateLock.unlock()
        guard inserted else {
            throw MobileExecutionError.invalidRequest("A mobile run with this runId already exists")
        }
        executionQueue.async { [weak self] in
            guard let self else { return }
            defer { self.finishRun(request.runId) }
            do {
                if self.isCancelled(request.runId) {
                    invoke.resolve(self.cancelledResponse(request))
                    return
                }
                let response = try self.execute(request)
                invoke.resolve(response)
            } catch {
                invoke.reject("iOS command failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func cancel(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(CancelArgs.self)
        stateLock.lock()
        let scheduled = scheduledRuns.contains(request.runId)
        if scheduled { cancelledRuns.insert(request.runId) }
        if activeCommand?.runId == request.runId, var command = activeCommand {
            command.cancelled = true
            activeCommand = command
            ios_killpid(command.pid, SIGINT)
            scheduleForcedTermination(runId: request.runId, pid: command.pid)
        }
        stateLock.unlock()
        invoke.resolve(["cancelled": scheduled])
    }

    private func execute(_ request: RunArgs) throws -> [String: Any] {
        try initializeBackendIfNeeded()
        if request.wasi != nil && !wasiExecutionAvailable {
            throw MobileExecutionError.invalidRequest(
                "WASI execution is disabled because this runtime cannot enforce timeout or cancellation"
            )
        }
        let workspace = try resolveWorkspace(request.workdir)
        let cwd = try resolveCwd(request.cwd, in: workspace)
        let input = try decodeInput(request.stdinBase64)
        let startedAt = DispatchTime.now().uptimeNanoseconds
        let result: AShellCommandResult
        if let wasi = request.wasi {
            let wasm = try AShellWasmExecutor.run(
                modulePath: wasi.modulePath,
                arguments: wasi.arguments,
                workdir: workspace.path,
                stdin: input
            )
            result = AShellCommandResult(
                exitCode: wasm.exitCode,
                stdout: wasm.stdout,
                stderr: wasm.stderr,
                stdoutTruncated: wasm.stdoutTruncated,
                stderrTruncated: wasm.stderrTruncated,
                timedOut: false,
                cancelled: isCancelled(request.runId),
                profile: "ios-a-shell-wasi",
                shell: "wasmkit"
            )
        } else {
            result = try executeShell(request, workspace: workspace, cwd: cwd, stdin: input)
        }
        let durationMs = (DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000
        return [
            "exitCode": result.exitCode,
            "backend": "ios-a-shell",
            "shell": result.shell,
            "platform": "ios",
            "profile": result.profile,
            "shellFamily": "posix",
            "stdout": result.stdout,
            "stderr": result.stderr,
            "stdoutTruncated": result.stdoutTruncated,
            "stderrTruncated": result.stderrTruncated,
            "timedOut": result.timedOut,
            "cancelled": result.cancelled,
            "stdioOpenAfterExit": false,
            "effectiveTimeoutMs": request.timeoutMs,
            "durationMs": durationMs,
        ]
    }

    private func executeShell(
        _ request: RunArgs,
        workspace: URL,
        cwd: URL,
        stdin: Data?
    ) throws -> AShellCommandResult {
        let previousCwd = FileManager.default.currentDirectoryPath
        guard FileManager.default.changeCurrentDirectoryPath(cwd.path) else {
            throw MobileExecutionError.invalidRequest("Could not enter cwd")
        }
        defer { _ = FileManager.default.changeCurrentDirectoryPath(previousCwd) }
        guard ios_setMiniRoot(workspace.path) == 1 else {
            throw MobileExecutionError.invalidRequest("Could not restrict the iOS shell to workdir")
        }
        guard let resourcePath = Bundle.module.resourcePath else {
            throw MobileExecutionError.invalidRequest("Bundled iOS shell resources are missing")
        }
        var allowedPaths = [resourcePath]
        if !isPath(cwd.path, inside: workspace.path) {
            allowedPaths.append(cwd.path)
        }
        guard ios_setAllowedPaths(allowedPaths) == 1 else {
            throw MobileExecutionError.invalidRequest(
                "Could not configure the allowed paths for this iOS shell run"
            )
        }

        let stdinFile = try TemporaryInput(data: stdin)
        let stdout = try BoundedPOSIXPipe()
        let stderr = try BoundedPOSIXPipe()
        let stdinStream = try stdinFile.duplicateStream()
        let stdoutStream = try stdout.makeWriteStream()
        let stderrStream = try stderr.makeWriteStream()

        ios_switchSession(sessionIdentifier)
        ios_setContext(UnsafeMutableRawPointer(sessionIdentifier))
        thread_stdin = nil
        thread_stdout = nil
        thread_stderr = nil
        ios_setStreams(stdinStream, stdoutStream, stderrStream)
        setenv("LC_CTYPE", "UTF-8", 1)
        setlocale(LC_CTYPE, "UTF-8")
        configureCommandEnvironment(workspace: workspace)

        let pid = ios_fork()
        stateLock.lock()
        let wasCancelled = cancelledRuns.contains(request.runId)
        activeCommand = ActiveCommand(
            runId: request.runId,
            pid: pid,
            cancelled: wasCancelled,
            timedOut: false
        )
        stateLock.unlock()
        if wasCancelled { ios_killpid(pid, SIGINT) }
        scheduleTimeout(runId: request.runId, pid: pid, timeoutMs: request.timeoutMs)

        var exitCode = ios_system(request.command)
        fflush(stdoutStream)
        fflush(stderrStream)
        ios_waitpid(pid)
        ios_releaseThreadId(pid)
        if exitCode == 0 { exitCode = ios_getCommandStatus() }

        stateLock.lock()
        let finalState = activeCommand
        activeCommand = nil
        stateLock.unlock()

        fclose(stdinStream)
        fclose(stdoutStream)
        fclose(stderrStream)
        stdinFile.close()
        stdout.closeWriter()
        stderr.closeWriter()
        let stdoutResult = stdout.finish()
        let stderrResult = stderr.finish()

        return AShellCommandResult(
            exitCode: exitCode,
            stdout: stdoutResult.text,
            stderr: stderrResult.text,
            stdoutTruncated: stdoutResult.truncated,
            stderrTruncated: stderrResult.truncated,
            timedOut: finalState?.timedOut ?? false,
            cancelled: finalState?.cancelled ?? false,
            profile: "ios-a-shell-bsd",
            shell: "sh"
        )
    }

    private func initializeBackendIfNeeded() throws {
        initializationLock.lock()
        defer { initializationLock.unlock() }
        if initialized { return }
        initializeEnvironment()
        for resource in ["commandDictionary", "extraCommandsDictionary"] {
            guard let path = Bundle.module.path(forResource: resource, ofType: "plist") else {
                throw MobileExecutionError.io("Missing bundled \(resource).plist")
            }
            if let error = addCommandList(path) {
                throw MobileExecutionError.io("Could not load \(resource).plist: \(error.localizedDescription)")
            }
        }
        initialized = true
    }

    private func scheduleTimeout(runId: String, pid: Int32, timeoutMs: UInt64) {
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + .milliseconds(Int(min(timeoutMs, UInt64(Int.max))))
        ) { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            if var command = self.activeCommand,
               command.runId == runId,
               command.pid == pid,
               !command.cancelled {
                command.timedOut = true
                self.activeCommand = command
                ios_killpid(pid, SIGINT)
                self.scheduleForcedTermination(runId: runId, pid: pid)
            }
            self.stateLock.unlock()
        }
    }

    private func validate(_ request: RunArgs) throws {
        try validateRunId(request.runId)
        guard request.wasi == nil || request.command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw MobileExecutionError.invalidRequest("Use either a shell command or a WASI invocation, not both")
        }
        guard request.wasi != nil || !request.command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw MobileExecutionError.invalidRequest("command is required for shell execution")
        }
        guard request.command.count <= 256 * 1024 else {
            throw MobileExecutionError.invalidRequest("command is too large")
        }
        guard request.timeoutMs >= 1_000, request.timeoutMs <= 600_000 else {
            throw MobileExecutionError.invalidRequest("timeoutMs must be between 1000 and 600000")
        }
    }

    private func scheduleForcedTermination(runId: String, pid: Int32) {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + .milliseconds(500)) {
            [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            let shouldTerminate = self.activeCommand?.runId == runId
                && self.activeCommand?.pid == pid
            self.stateLock.unlock()
            if shouldTerminate { ios_killpid(pid, SIGKILL) }
        }
    }

    private func validateRunId(_ runId: String) throws {
        let runIdPattern = try NSRegularExpression(pattern: "^[A-Za-z0-9._-]{1,128}$")
        let range = NSRange(runId.startIndex..., in: runId)
        guard runIdPattern.firstMatch(in: runId, range: range) != nil else {
            throw MobileExecutionError.invalidRequest("runId has an invalid format")
        }
    }

    private func resolveWorkspace(_ path: String) throws -> URL {
        let url = URL(fileURLWithPath: path, isDirectory: true)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        var isDirectory: ObjCBool = false
        guard url.path.hasPrefix("/"),
              FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              isDirectory.boolValue,
              (isPath(url.path, inside: sandboxRootPath())
                  || externalWorkspaces.contains(path: url.path)) else {
            throw MobileExecutionError.invalidRequest("workdir must be an existing directory")
        }
        return url
    }

    private func resolveCwd(_ relative: String?, in workspace: URL) throws -> URL {
        let raw = relative?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.isEmpty || raw == "." { return workspace }
        guard !raw.contains("\\"), !raw.contains("\0") else {
            throw MobileExecutionError.invalidRequest("cwd must be a POSIX path")
        }
        if raw.hasPrefix("/") {
            let target = URL(fileURLWithPath: raw, isDirectory: true)
                .resolvingSymlinksInPath()
                .standardizedFileURL
            var isDirectory: ObjCBool = false
            guard isPath(target.path, inside: workspace.path),
                  FileManager.default.fileExists(atPath: target.path, isDirectory: &isDirectory),
                  isDirectory.boolValue else {
                throw MobileExecutionError.invalidRequest(
                    "absolute cwd must be an existing directory inside the XAgent application sandbox"
                )
            }
            return target
        }
        let parts = raw.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw MobileExecutionError.invalidRequest("cwd must be a normalized relative path")
        }
        let target = workspace.appendingPathComponent(raw, isDirectory: true)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        guard target.path.hasPrefix(workspace.path + "/") else {
            throw MobileExecutionError.invalidRequest("cwd escapes workdir")
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: target.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw MobileExecutionError.invalidRequest("cwd does not exist")
        }
        return target
    }

    private func sandboxRootPath() -> String {
        URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .resolvingSymlinksInPath()
            .standardizedFileURL.path
    }

    private func isPath(_ candidate: String, inside root: String) -> Bool {
        candidate == root || candidate.hasPrefix(root + "/")
    }

    private static func topViewController() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
        var current = root
        while let presented = current?.presentedViewController {
            current = presented
        }
        if let navigation = current as? UINavigationController {
            return navigation.visibleViewController ?? navigation
        }
        if let tabs = current as? UITabBarController {
            return tabs.selectedViewController ?? tabs
        }
        return current
    }

    private func decodeInput(_ value: String?) throws -> Data? {
        guard let value, !value.isEmpty else { return nil }
        guard let data = Data(base64Encoded: value), data.count <= 1024 * 1024 else {
            throw MobileExecutionError.invalidRequest("stdin is invalid or exceeds 1 MiB")
        }
        return data
    }

    private func configureCommandEnvironment(workspace: URL) {
        let resources = Bundle.module.resourceURL
        let temporary = workspace.appendingPathComponent(".xagent-tmp", isDirectory: true)
        try? FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        setenv("HOME", workspace.path, 1)
        setenv("TMPDIR", temporary.path, 1)
        setenv("PATH", "\(workspace.path)/bin:/usr/bin:/bin", 1)
        setenv("APPDIR", resources?.path ?? "", 1)
        setenv("VIMRUNTIME", resources?.appendingPathComponent("vim").path ?? "", 1)
        setenv("TERMINFO", resources?.appendingPathComponent("terminfo").path ?? "", 1)
        setenv("SSL_CERT_FILE", resources?.appendingPathComponent("cacert.pem").path ?? "", 1)
        setenv("TERM", "xterm-256color", 1)
        setenv("LANG", "C.UTF-8", 1)
    }

    private func isCancelled(_ runId: String) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return cancelledRuns.contains(runId)
    }

    private func finishRun(_ runId: String) {
        stateLock.lock()
        scheduledRuns.remove(runId)
        cancelledRuns.remove(runId)
        if activeCommand?.runId == runId { activeCommand = nil }
        stateLock.unlock()
    }

    private func cancelledResponse(_ request: RunArgs) -> [String: Any] {
        [
            "exitCode": -1,
            "backend": "ios-a-shell",
            "shell": request.wasi == nil ? "ios_system" : "wasmkit",
            "platform": "ios",
            "profile": request.wasi == nil ? "ios-a-shell-bsd" : "ios-a-shell-wasi",
            "shellFamily": "posix",
            "stdout": "",
            "stderr": "",
            "stdoutTruncated": false,
            "stderrTruncated": false,
            "timedOut": false,
            "cancelled": true,
            "stdioOpenAfterExit": false,
            "effectiveTimeoutMs": request.timeoutMs,
            "durationMs": 0,
        ]
    }

    private func shellResourceStatus() -> IOSShellResourceStatus {
        let resources = Bundle.module.resourceURL
        return IOSShellResourceStatus(
            vim: resources.map {
                FileManager.default.fileExists(
                    atPath: $0.appendingPathComponent("vim/syntax/syntax.vim").path
                )
            } ?? false,
            certificateBundle: resources.map {
                FileManager.default.fileExists(atPath: $0.appendingPathComponent("cacert.pem").path)
            } ?? false
        )
    }

    deinit {
        free(sessionIdentifier)
    }
}

private struct AShellCommandResult {
    let exitCode: Int32
    let stdout: String
    let stderr: String
    let stdoutTruncated: Bool
    let stderrTruncated: Bool
    let timedOut: Bool
    let cancelled: Bool
    let profile: String
    let shell: String
}

@_cdecl("init_plugin_mobile_execution")
func initPlugin() -> Plugin {
    MobileExecutionPlugin()
}
