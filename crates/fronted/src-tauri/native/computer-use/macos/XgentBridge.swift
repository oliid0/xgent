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
            if operation == "capture_preview" {
                guard CGPreflightScreenCaptureAccess() else {
                    throw ComputerUseError.message("Screen recording permission is required for the live preview")
                }
                let app = try AppDiscovery.resolve(arguments["app"] as? String ?? "", allowLaunch: false)
                guard let capture = WindowCapture.resolve(for: app.pid, titleHint: nil),
                      let png = capture.pngDataIfAvailable(maxDimension: CGFloat(arguments["max_image_size"] as? Int ?? 768)) else {
                    throw ComputerUseError.message("Unable to capture the target window")
                }
                let response: [String: Any] = ["content": [["type": "image", "data": png.base64EncodedString(), "mimeType": "image/png"]], "isError": false]
                let data = try JSONSerialization.data(withJSONObject: response)
                return strdup(String(decoding: data, as: UTF8.self))
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
