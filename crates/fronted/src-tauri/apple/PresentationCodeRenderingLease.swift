import Foundation
import ObjectiveC
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor
final class XgentCodeRenderingLease: NSObject {
    private static var key: UInt8 = 0
    static func current(_ manager: NSTextLayoutManager) -> XgentCodeRenderingLease? {
        objc_getAssociatedObject(manager, &key) as? XgentCodeRenderingLease
    }
    static func set(_ lease: XgentCodeRenderingLease?, on manager: NSTextLayoutManager) {
        objc_setAssociatedObject(manager, &key, lease, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }
    func owns(_ manager: NSTextLayoutManager) -> Bool { Self.current(manager) === self }
}
