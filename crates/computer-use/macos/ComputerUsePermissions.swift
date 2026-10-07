import ApplicationServices
import CoreGraphics
import Foundation

// Read-only status checks do not prompt. Requests run only after the settings
// action has selected a specific permission; AX authorization is asynchronous.
@_cdecl("xgent_cua_permissions")
public func xgentCuaPermissions(_ request: Int32) -> UInt8 {
    func query() -> UInt8 {
        if request == 1 {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
            _ = AXIsProcessTrustedWithOptions(options as CFDictionary)
        } else if request == 2 {
            _ = CGRequestScreenCaptureAccess()
        }
        return (AXIsProcessTrusted() ? 1 : 0) | (CGPreflightScreenCaptureAccess() ? 2 : 0)
    }
    if Thread.isMainThread { return query() }
    return DispatchQueue.main.sync(execute: query)
}
