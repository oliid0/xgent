import Foundation

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
        _ = (modulePath, arguments, workdir, stdin)
        throw MobileExecutionError.invalidRequest(
            "WASI execution is not included because the runtime cannot enforce cancellation"
        )
    }
}
