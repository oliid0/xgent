import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// An open file keeps its native editor mounted in the application's window
// while another tab is visible. Removing a hosting root from every window can
// tear down its representables even when the hosting object itself is retained.
@MainActor
final class XgentCodeHostParking {
    private(set) var isParked = false
    private var suspendViewport: (() -> Void)?
    private var resumeViewport: (() -> Void)?

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

    func remember(_ input: UIView) {
        guard let root = input.window?.rootViewController else { return }
        owner = root
        self.input = input as? UITextView
    }
    func park(_ host: XgentCodeHostingController) -> Bool {
        guard let owner, owner.view.window != nil, owner !== host else { return false }
        isParked = true
        input?.isEditable = false
        let size = host.view.bounds.size
        container.isHidden = true
        container.isAccessibilityElement = false
        container.accessibilityElementsHidden = true
        container.frame = CGRect(origin: .zero, size: size)
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
    private let container = NSView()
    private weak var input: NSTextView?

    func remember(_ input: NSView) {
        guard let root = input.window?.contentView else { return }
        owner = root
        self.input = input as? NSTextView
    }
    func park(_ host: XgentCodeHostingView) -> Bool {
        guard let owner, owner.window != nil, owner !== host else { return false }
        isParked = true
        input?.isEditable = false
        let size = host.bounds.size
        container.isHidden = true
        container.setAccessibilityElement(false)
        container.frame = CGRect(origin: .zero, size: size)
        if container.superview !== owner { owner.addSubview(container) }
        host.removeFromSuperview()
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
