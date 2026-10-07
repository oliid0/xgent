import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit

@MainActor
private final class XgentCodeParkingContainer: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func accessibilityChildren() -> [Any]? { [] }
}
#endif

// An open file keeps its native editor mounted in the application's window
// while another tab is visible. Removing a hosting root from every window can
// tear down its representables even when the hosting object itself is retained.
@MainActor
final class XgentCodeHostParking {
    private(set) var isParked = false
    private var suspendViewport: (() -> Void)?
    private var resumeViewport: (() -> Void)?
    private var parks = 0
    var evidence: [String: String] {
        ["parked": String(isParked), "parks": String(parks), "ownerExists": String(owner != nil),
         "ownerInWindow": String(ownerInWindow), "nativeInput": input.map { String(describing: ObjectIdentifier($0)) } ?? "nil",
         "inputInWindow": String(input?.window != nil)]
    }
    private var ownerInWindow: Bool {
        #if os(iOS)
        owner?.viewIfLoaded?.window != nil
        #else
        owner?.window != nil
        #endif
    }

    func viewport(suspend: @escaping () -> Void, resume: @escaping () -> Void) {
        suspendViewport = suspend
        resumeViewport = resume
    }
    func suspend() { suspendViewport?() }
    func resume() {
        guard isParked else { return }
        isParked = false
        resumeViewport?()
    }
    #if os(iOS)
    private weak var owner: UIViewController?
    private let container = UIView()
    private weak var input: UITextView?
    private weak var window: UIWindow?

    func remember(_ input: UIView) {
        guard let root = input.window?.rootViewController else { return }
        owner = root
        window = input.window
        if let textView = input as? UITextView { self.input = textView }
    }
    func park(_ host: XgentCodeHostingController) -> Bool {
        guard let owner, let window, owner.viewIfLoaded?.window === window, owner !== host else { return false }
        isParked = true
        parks += 1
        input?.isEditable = false
        let size = host.view.bounds.size
        // Keep the hosting graph rendering while its file is inactive. Hiding
        // a hosting ancestor can dismantle its native representables.
        container.alpha = 0
        container.isUserInteractionEnabled = false
        container.isAccessibilityElement = false
        container.accessibilityElementsHidden = true
        container.frame = CGRect(origin: .zero, size: size)
        // Keep the child controller's view under its parent's view. Mounting
        // it directly on UIWindow violates UIKit controller containment.
        if container.superview !== owner.view { owner.view.addSubview(container) }
        if host.parent !== owner {
            if host.parent != nil { host.willMove(toParent: nil) }
            host.view.removeFromSuperview()
            host.removeFromParent()
            owner.addChild(host)
            host.view.translatesAutoresizingMaskIntoConstraints = true
            host.view.frame = container.bounds
            container.addSubview(host.view)
            host.didMove(toParent: owner)
        } else {
            host.view.translatesAutoresizingMaskIntoConstraints = true
            host.view.frame = container.bounds
            container.addSubview(host.view)
        }
        return true
    }
    #else
    private weak var owner: NSView?
    private let container = XgentCodeParkingContainer()
    private weak var input: NSTextView?

    func remember(_ input: NSView) {
        guard let content = input.window?.contentView else { return }
        // Tauri's content root is a plain native container. The system's
        // NSThemeFrame and a SwiftUI-managed NSHostingView are not parking
        // parents; both report unsupported subviews when mutated directly.
        guard !String(reflecting: type(of: content)).contains("NSHostingView") else { return }
        owner = content
        if let textView = input as? NSTextView { self.input = textView }
    }
    func park(_ host: XgentCodeHostingView) -> Bool {
        guard let owner, owner.window != nil, owner !== host else { return false }
        isParked = true
        parks += 1
        input?.isEditable = false
        let size = host.bounds.size
        container.alphaValue = 0
        container.setAccessibilityElement(false)
        container.setAccessibilityHidden(true)
        container.frame = CGRect(origin: .zero, size: size)
        if container.superview !== owner { owner.addSubview(container) }
        // Move directly between parents in the same window. Explicit removal
        // sends a nil window to NSHostingView and destroys its representables.
        host.translatesAutoresizingMaskIntoConstraints = true
        host.frame = container.bounds
        container.addSubview(host)
        return true
    }
    #endif

    func clear() {
        container.removeFromSuperview()
        owner = nil
        input = nil
        #if os(iOS)
        window = nil
        #endif
        suspendViewport = nil
        resumeViewport = nil
        isParked = false
    }
}

private struct XgentCodeHostParkingKey: EnvironmentKey {
    static let defaultValue: XgentCodeHostParking? = nil
}

extension EnvironmentValues {
    var xgentCodeHostParking: XgentCodeHostParking? {
        get { self[XgentCodeHostParkingKey.self] }
        set { self[XgentCodeHostParkingKey.self] = newValue }
    }
}
