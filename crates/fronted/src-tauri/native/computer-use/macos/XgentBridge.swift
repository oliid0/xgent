import AppKit
import ApplicationServices
import Foundation

// The Rust command serializes calls and invokes this off the UI thread. AppKit
// work in the driver is dispatched onto Xgent's existing application run loop.
private let xgentDispatcher = ComputerUseToolDispatcher()

struct PermissionDiagnostics {
    let accessibilityTrusted: Bool
    let screenCaptureGranted: Bool

    static func current(requestScreenCapture: Bool = true) -> PermissionDiagnostics {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        let accessibility = AXIsProcessTrustedWithOptions(options as CFDictionary)
        let screenCapture = CGPreflightScreenCaptureAccess()
        if !screenCapture && requestScreenCapture { _ = CGRequestScreenCaptureAccess() }
        return PermissionDiagnostics(
            accessibilityTrusted: accessibility,
            screenCaptureGranted: screenCapture
        )
    }
}

@_cdecl("xgent_cua_call")
public func xgentCuaCall(_ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    autoreleasepool {
        let result: ToolCallResult
        do {
            let data = Data(String(cString: request).utf8)
            guard let input = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let operation = input["operation"] as? String else {
                throw ComputerUseError.message("Invalid Xgent computer-use request")
            }
            let arguments = input["arguments"] as? [String: Any] ?? [:]
            if let target = arguments["app"] as? String,
               ["xgent", "com.ohi.xgent", String(ProcessInfo.processInfo.processIdentifier)]
                .contains(target.lowercased()) {
                throw ComputerUseError.message("Choose a target application other than Xgent")
            }
            result = xgentDispatcher.callToolAsResult(name: operation, arguments: arguments)
        } catch {
            result = .text(error.localizedDescription, isError: true)
        }
        guard let data = try? JSONSerialization.data(withJSONObject: result.asDictionary),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return strdup(text)
    }
}

@_cdecl("xgent_cua_free")
public func xgentCuaFree(_ result: UnsafeMutablePointer<CChar>?) {
    free(result)
}
