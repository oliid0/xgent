#if os(iOS)
import SwiftUI
import UIKit

// iOS 26's hosted SecureField failed both real editing and AX traversal in CI.
// Keep a native secure UITextField inside SwiftUI with an explicit event bridge.
struct XgentIOSSecretField: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    let node: XgentNode
    @Environment(\.isEnabled) private var enabled
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var scale = 1.0

    func makeCoordinator() -> Coordinator { Coordinator(text: $text, focused: $focused) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.isSecureTextEntry = true
        // yy's provider form also opts out of login/password AutoFill.
        field.textContentType = .oneTimeCode
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.borderStyle = .none
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        field.isAccessibilityElement = true
        configure(field)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.text = $text
        context.coordinator.focused = $focused
        configure(field)
    }

    private func configure(_ field: UITextField) {
        if field.text != text && field.markedTextRange == nil { field.text = text }
        field.placeholder = node.text
        field.isEnabled = enabled
        field.font = .systemFont(ofSize: CGFloat(theme.typography.body * theme.fontScale) * scale)
        field.textColor = UIColor(Color(xgentHex: theme.palette(for: colorScheme).text))
        field.tintColor = UIColor(Color(xgentHex: theme.palette(for: colorScheme).accent))
        field.accessibilityIdentifier = node.id
        field.accessibilityLabel = node.accessibilityLabel ?? node.label ?? ""
        field.accessibilityHint = node.accessibilityHint
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextField, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? uiView.intrinsicContentSize.width,
               height: max(uiView.font?.lineHeight ?? 0, 24))
    }

    static func dismantleUIView(_ field: UITextField, coordinator: Coordinator) {
        field.removeTarget(coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        field.delegate = nil
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var text: Binding<String>
        var focused: Binding<Bool>

        init(text: Binding<String>, focused: Binding<Bool>) {
            self.text = text
            self.focused = focused
        }

        @objc func changed(_ field: UITextField) {
            guard field.markedTextRange == nil else { return }
            let value = field.text ?? ""
            if text.wrappedValue != value { text.wrappedValue = value }
        }

        func textFieldDidBeginEditing(_ field: UITextField) { focused.wrappedValue = true }
        func textFieldDidEndEditing(_ field: UITextField) {
            changed(field)
            focused.wrappedValue = false
        }
        func textFieldShouldReturn(_ field: UITextField) -> Bool {
            changed(field)
            field.resignFirstResponder()
            return true
        }
    }
}
#endif
