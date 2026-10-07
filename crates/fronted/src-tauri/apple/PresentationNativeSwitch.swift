#if os(iOS)
import SwiftUI
import UIKit

// Keep the system switch appearance, while the real control, hit testing and
// accessibility share the same 44-point target rather than a SwiftUI wrapper.
struct XgentIOSNativeSwitch: UIViewRepresentable {
    @Binding var value: Bool
    let node: XgentNode
    @Environment(\.isEnabled) private var enabled

    func makeCoordinator() -> Coordinator { Coordinator(value: $value) }

    func makeUIView(context: Context) -> XgentNativeSwitch {
        let control = XgentNativeSwitch()
        control.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
        configure(control)
        return control
    }

    func updateUIView(_ control: XgentNativeSwitch, context: Context) {
        context.coordinator.value = $value
        configure(control)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: XgentNativeSwitch, context: Context) -> CGSize? {
        uiView.intrinsicContentSize
    }

    private func configure(_ control: XgentNativeSwitch) {
        control.setOn(value, animated: false)
        control.isEnabled = enabled && node.disabled != true
        control.onTintColor = .systemGreen
        control.isAccessibilityElement = true
        control.accessibilityIdentifier = node.id
        control.accessibilityLabel = node.accessibilityLabel ?? node.label ?? ""
        control.accessibilityHint = node.accessibilityHint ?? node.text ?? ""
    }

    static func dismantleUIView(_ control: XgentNativeSwitch, coordinator: Coordinator) {
        coordinator.active = false
        control.removeTarget(coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
    }

    @MainActor final class Coordinator: NSObject {
        var value: Binding<Bool>
        var active = true
        init(value: Binding<Bool>) { self.value = value }
        @objc func changed(_ control: UISwitch) {
            guard active, control.isEnabled else { return }
            value.wrappedValue = control.isOn
        }
    }
}

@MainActor final class XgentNativeSwitch: UISwitch {
    override var intrinsicContentSize: CGSize {
        CGSize(width: max(44, super.intrinsicContentSize.width), height: 44)
    }
    override func sizeThatFits(_ size: CGSize) -> CGSize { intrinsicContentSize }
    override var accessibilityFrame: CGRect {
        get { UIAccessibility.convertToScreenCoordinates(bounds, in: self) }
        set { super.accessibilityFrame = newValue }
    }
}
#endif
