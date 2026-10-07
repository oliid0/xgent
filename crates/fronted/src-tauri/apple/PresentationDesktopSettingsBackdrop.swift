#if os(macOS)
import AppKit
import SwiftUI

/// AppKit receives the initial click, including when the window is inactive.
/// The settings region never belongs to this dismissal target.
struct XgentDesktopSettingsBackdrop: NSViewRepresentable {
    let dialogSize: CGSize
    let cornerRadius: CGFloat
    let label: String
    let enabled: Bool
    let dismiss: () -> Void

    func makeNSView(context: Context) -> XgentDesktopSettingsDismissView {
        let view = XgentDesktopSettingsDismissView()
        view.setAccessibilityElement(true)
        view.setAccessibilityRole(.button)
        view.setAccessibilityIdentifier("settings-dismiss-backdrop")
        updateNSView(view, context: context)
        return view
    }

    func updateNSView(_ view: XgentDesktopSettingsDismissView, context: Context) {
        view.dialogSize = dialogSize
        view.cornerRadius = cornerRadius
        view.enabled = enabled
        view.dismiss = dismiss
        view.setAccessibilityLabel(label)
        view.setAccessibilityEnabled(enabled)
    }

    static func dismantleNSView(_ view: XgentDesktopSettingsDismissView, coordinator: ()) {
        view.dismiss = nil
    }
}

final class XgentDesktopSettingsDismissView: NSView {
    var dialogSize: CGSize = .zero
    var cornerRadius: CGFloat = 0
    var enabled = false
    var dismiss: (() -> Void)?

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        let dialog = NSRect(x: bounds.midX - dialogSize.width / 2,
                            y: bounds.midY - dialogSize.height / 2,
                            width: dialogSize.width, height: dialogSize.height)
        guard bounds.contains(local),
              !NSBezierPath(roundedRect: dialog, xRadius: cornerRadius, yRadius: cornerRadius).contains(local) else { return nil }
        return self
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {
        if enabled { dismiss?() }
    }
    override func accessibilityPerformPress() -> Bool {
        guard enabled, let dismiss else { return false }
        dismiss()
        return true
    }
}
#endif
