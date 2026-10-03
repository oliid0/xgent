#if os(macOS)
import AppKit
import Carbon.HIToolbox
import KeyboardShortcuts
import SwiftUI

// Carbon's physical key positions preserve KeyboardEvent.code semantics across
// layouts. KeyboardShortcuts supplies the localized key/glyph display and OS
// conflict lookup; it never registers or stores Xgent's hotkeys.
enum XgentShortcutKeys {
    static let codes: [Int: String] = [
        kVK_ANSI_A: "KeyA", kVK_ANSI_B: "KeyB", kVK_ANSI_C: "KeyC", kVK_ANSI_D: "KeyD",
        kVK_ANSI_E: "KeyE", kVK_ANSI_F: "KeyF", kVK_ANSI_G: "KeyG", kVK_ANSI_H: "KeyH",
        kVK_ANSI_I: "KeyI", kVK_ANSI_J: "KeyJ", kVK_ANSI_K: "KeyK", kVK_ANSI_L: "KeyL",
        kVK_ANSI_M: "KeyM", kVK_ANSI_N: "KeyN", kVK_ANSI_O: "KeyO", kVK_ANSI_P: "KeyP",
        kVK_ANSI_Q: "KeyQ", kVK_ANSI_R: "KeyR", kVK_ANSI_S: "KeyS", kVK_ANSI_T: "KeyT",
        kVK_ANSI_U: "KeyU", kVK_ANSI_V: "KeyV", kVK_ANSI_W: "KeyW", kVK_ANSI_X: "KeyX",
        kVK_ANSI_Y: "KeyY", kVK_ANSI_Z: "KeyZ",
        kVK_ANSI_0: "Digit0", kVK_ANSI_1: "Digit1", kVK_ANSI_2: "Digit2", kVK_ANSI_3: "Digit3",
        kVK_ANSI_4: "Digit4", kVK_ANSI_5: "Digit5", kVK_ANSI_6: "Digit6", kVK_ANSI_7: "Digit7",
        kVK_ANSI_8: "Digit8", kVK_ANSI_9: "Digit9",
        kVK_Space: "Space", kVK_Tab: "Tab", kVK_Delete: "Backspace", kVK_ForwardDelete: "Delete",
        kVK_ANSI_Grave: "Backquote", kVK_ANSI_Minus: "Minus", kVK_ANSI_Equal: "Equal",
        kVK_ANSI_LeftBracket: "BracketLeft", kVK_ANSI_RightBracket: "BracketRight",
        kVK_ANSI_Backslash: "Backslash", kVK_ANSI_Semicolon: "Semicolon", kVK_ANSI_Quote: "Quote",
        kVK_ANSI_Comma: "Comma", kVK_ANSI_Period: "Period", kVK_ANSI_Slash: "Slash",
        kVK_UpArrow: "ArrowUp", kVK_DownArrow: "ArrowDown", kVK_LeftArrow: "ArrowLeft", kVK_RightArrow: "ArrowRight",
        kVK_Home: "Home", kVK_End: "End", kVK_PageUp: "PageUp", kVK_PageDown: "PageDown",
        kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5",
        kVK_F6: "F6", kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10",
        kVK_F11: "F11", kVK_F12: "F12", kVK_F13: "F13", kVK_F14: "F14", kVK_F15: "F15",
        kVK_F16: "F16", kVK_F17: "F17", kVK_F18: "F18", kVK_F19: "F19", kVK_F20: "F20",
        kVK_ANSI_Keypad0: "Numpad0", kVK_ANSI_Keypad1: "Numpad1", kVK_ANSI_Keypad2: "Numpad2",
        kVK_ANSI_Keypad3: "Numpad3", kVK_ANSI_Keypad4: "Numpad4", kVK_ANSI_Keypad5: "Numpad5",
        kVK_ANSI_Keypad6: "Numpad6", kVK_ANSI_Keypad7: "Numpad7", kVK_ANSI_Keypad8: "Numpad8",
        kVK_ANSI_Keypad9: "Numpad9", kVK_ANSI_KeypadPlus: "NumpadAdd", kVK_ANSI_KeypadMinus: "NumpadSubtract",
        kVK_ANSI_KeypadMultiply: "NumpadMultiply", kVK_ANSI_KeypadDivide: "NumpadDivide",
        kVK_ANSI_KeypadDecimal: "NumpadDecimal", kVK_ANSI_KeypadEquals: "NumpadEqual",
    ]

    static func accelerator(_ event: NSEvent) -> String? {
        guard let key = codes[Int(event.keyCode)] else { return nil }
        var tokens: [String] = []
        if event.modifierFlags.contains(.control) { tokens.append("Ctrl") }
        if event.modifierFlags.contains(.shift) { tokens.append("Shift") }
        if event.modifierFlags.contains(.option) { tokens.append("Alt") }
        if event.modifierFlags.contains(.command) { tokens.append("Super") }
        return (tokens + [key]).joined(separator: "+")
    }

    @MainActor static func display(_ accelerator: String) -> String {
        let tokens = accelerator.split(separator: "+").map(String.init)
        guard let key = tokens.last, let code = codes.first(where: { $0.value == key })?.key else { return accelerator }
        let physical = KeyboardShortcuts.Key(rawValue: code)
        var flags: NSEvent.ModifierFlags = []
        if tokens.contains("Ctrl") { flags.insert(.control) }
        if tokens.contains("Shift") { flags.insert(.shift) }
        if tokens.contains("Alt") { flags.insert(.option) }
        if tokens.contains("Super") { flags.insert(.command) }
        return String(describing: KeyboardShortcuts.Shortcut(physical, modifiers: flags))
    }
}

struct XgentShortcutBindingButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        Button { model.send(node, in: document) } label: {
            XgentShortcutBindingLabel(node: node)
        }
        .buttonStyle(XgentActionButtonStyle(node: node))
        .modifier(XgentControlTypography(node: node))
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityLabel(node.label ?? "")
        .accessibilityValue(node.text ?? "")
    }
}

struct XgentShortcutRecorder: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .body) private var scale = 1.0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            XgentFieldLabel(node: node)
            XgentShortcutCapture(node: node,
                fontSize: CGFloat(theme.typography.body * theme.fontScale) * scale,
                fontFamily: theme.codeFontFamily, send: { phase, accelerator in
                var event: [String: String] = ["phase": phase]
                if let accelerator { event["accelerator"] = accelerator }
                guard let data = try? JSONSerialization.data(withJSONObject: event),
                      let payload = String(data: data, encoding: .utf8) else { return }
                model.send(node, in: document, value: .string(payload), continuous: true)
            })
            .frame(height: max(44, CGFloat(theme.typography.body * theme.fontScale) * scale + 20))
            .modifier(XgentFieldSurface(node: node, active: node.disabled != true))
            if let hint = node.text {
                Text(hint).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .modifier(XgentControlTypography(node: node))
    }
}

struct XgentShortcutCapture: NSViewRepresentable {
    let node: XgentNode
    let fontSize: CGFloat
    let fontFamily: String?
    let send: (String, String?) -> Void

    func makeNSView(context: Context) -> XgentShortcutCaptureView {
        let view = XgentShortcutCaptureView()
        updateNSView(view, context: context)
        return view
    }

    func updateNSView(_ view: XgentShortcutCaptureView, context: Context) {
        view.send = send
        view.setAccessibilityIdentifier(node.id)
        view.setAccessibilityLabel(node.label)
        view.configureFont(family: fontFamily, size: fontSize)
        view.configure(accelerator: node.value?.text ?? "", enabled: node.disabled != true)
    }

    static func dismantleNSView(_ view: XgentShortcutCaptureView, coordinator: ()) {
        view.retire()
    }
}

final class XgentShortcutCaptureView: NSView {
    var send: ((String, String?) -> Void)?
    private let label = NSTextField(labelWithString: "")
    private var accelerator = ""
    private var enabled = false
    private var finished = false
    private var hasStarted = false
    private var windowObserver: NSObjectProtocol?
    var systemConflict: (KeyboardShortcuts.Shortcut) -> Bool = { $0.isTakenBySystem }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        label.alignment = .center
        label.font = .monospacedSystemFont(ofSize: 16, weight: .medium)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.setAccessibilityElement(false)
        addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.textField)
    }

    convenience init() { self.init(frame: .zero) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unsupported") }
    override var acceptsFirstResponder: Bool { enabled && !finished }

    func configure(accelerator: String, enabled: Bool) {
        if !hasStarted { self.accelerator = accelerator }
        self.enabled = enabled
        if enabled { hasStarted = true }
        label.stringValue = self.accelerator.isEmpty ? "…" : XgentShortcutKeys.display(self.accelerator)
        setAccessibilityValue(self.accelerator)
        if enabled && !finished && window?.firstResponder !== self { window?.makeFirstResponder(self) }
    }

    override func viewDidMoveToWindow() {
        if let windowObserver { NotificationCenter.default.removeObserver(windowObserver) }
        windowObserver = nil
        guard let window else { return }
        windowObserver = NotificationCenter.default.addObserver(forName: NSWindow.didResignKeyNotification,
            object: window, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.finish("cancel") }
            }
        if enabled && !finished { window.makeFirstResponder(self) }
    }

    override func keyDown(with event: NSEvent) { handle(event) }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard enabled, !finished, window?.firstResponder === self else { return false }
        handle(event)
        return true
    }

    private func handle(_ event: NSEvent) {
        guard enabled, !finished, !event.isARepeat else { return }
        if Int(event.keyCode) == kVK_Escape { finish("cancel"); return }
        if Int(event.keyCode) == kVK_Return || Int(event.keyCode) == kVK_ANSI_KeypadEnter {
            // Include the current native draft so Enter immediately after a key
            // cannot accidentally save the preceding React document's value.
            send?("confirm", accelerator)
            return
        }
        guard let next = XgentShortcutKeys.accelerator(event),
              let shortcut = KeyboardShortcuts.Shortcut(event: event) else { return }
        if systemConflict(shortcut) {
            send?("systemConflict", nil)
            return
        }
        accelerator = next
        label.stringValue = String(describing: shortcut)
        setAccessibilityValue(next)
        send?("capture", next)
    }

    private func finish(_ phase: String) {
        guard enabled, !finished else { return }
        finished = true
        send?(phase, nil)
    }

    func configureFont(family: String?, size: CGFloat) {
        let named = XgentFonts.name(for: family).flatMap { NSFont(name: $0, size: size) }
        label.font = named ?? .monospacedSystemFont(ofSize: size, weight: .medium)
    }

    func retire() {
        // Settings navigation also restores through the shared effect cleanup;
        // this event covers removal/deactivation without a route transition.
        finish("cancel")
        if let windowObserver { NotificationCenter.default.removeObserver(windowObserver) }
        windowObserver = nil
        send = nil
        enabled = false
    }
}
#endif
