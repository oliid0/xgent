// Derived from a-Shell's a-Shell/WasmKit.swift.
// Copyright (c) 2019-2024, Nicolas Holzschuch.
// Distributed under the BSD 3-Clause license; see THIRD_PARTY_NOTICES.md.

import Foundation
import SystemPackage
import WasmKit
import WasmKitWASI
import WAT

struct AShellWasmResult {
    let exitCode: Int32
    let stdout: String
    let stderr: String
    let stdoutTruncated: Bool
    let stderrTruncated: Bool
}

enum AShellWasmExecutor {
    static func run(
        modulePath: String,
        arguments: [String],
        workdir: String,
        stdin: Data?
    ) throws -> AShellWasmResult {
        let moduleURL = URL(fileURLWithPath: modulePath)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let workspaceURL = URL(fileURLWithPath: workdir, isDirectory: true)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        guard moduleURL.path == workspaceURL.path || moduleURL.path.hasPrefix(workspaceURL.path + "/") else {
            throw MobileExecutionError.invalidRequest("WASI module must be inside workdir")
        }
        guard FileManager.default.isReadableFile(atPath: moduleURL.path) else {
            throw MobileExecutionError.invalidRequest("WASI module is not readable")
        }

        let stdout = try BoundedPOSIXPipe()
        let stderr = try BoundedPOSIXPipe()
        let stdinFile = try TemporaryInput(data: stdin)
        defer { stdinFile.close() }

        let module = try parseWasm(filePath: FilePath(moduleURL.path))
        let wasi = try WASIBridgeToHost(
            args: [moduleURL.lastPathComponent] + arguments,
            environment: [
                "HOME": "/workspace",
                "PATH": "/workspace/bin",
                "LANG": "C.UTF-8",
            ],
            preopens: ["/workspace": workspaceURL.path],
            stdin: FileDescriptor(rawValue: stdinFile.fileDescriptor),
            stdout: FileDescriptor(rawValue: stdout.writeDescriptor),
            stderr: FileDescriptor(rawValue: stderr.writeDescriptor)
        )
        let runtime = Runtime(hostModules: wasi.hostModules)
        let instance = try runtime.instantiate(module: module)
        let exitCode = try wasi.start(instance, runtime: runtime)

        stdout.closeWriter()
        stderr.closeWriter()
        let stdoutResult = stdout.finish()
        let stderrResult = stderr.finish()
        return AShellWasmResult(
            exitCode: Int32(exitCode),
            stdout: stdoutResult.text,
            stderr: stderrResult.text,
            stdoutTruncated: stdoutResult.truncated,
            stderrTruncated: stderrResult.truncated
        )
    }
}
