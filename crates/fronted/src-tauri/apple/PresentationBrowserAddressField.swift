import SwiftUI

private struct XgentBrowserAddressFocusRequest: EnvironmentKey { static let defaultValue = 0 }
extension EnvironmentValues {
    var xgentBrowserAddressFocusRequest: Int {
        get { self[XgentBrowserAddressFocusRequest.self] }
        set { self[XgentBrowserAddressFocusRequest.self] = newValue }
    }
}

struct XgentBrowserAddressField: View {
    let input: XgentNode
    let submit: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    var allowsEmpty = false
    @FocusState private var focused: Bool
    @Environment(\.xgentBrowserAddressFocusRequest) private var focusRequest

    private var text: Binding<String> {
        Binding(get: { model.value(input, in: document).text },
                set: { model.send(input, in: document, value: .string($0), editing: true) })
    }

    private func send() {
        guard allowsEmpty || !text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              input.disabled != true, submit.disabled != true, !model.isBusy(submit, in: document) else { return }
        model.send(submit, in: document, value: .string(text.wrappedValue))
    }

    private var field: some View {
        TextField(input.text ?? input.label ?? "", text: text)
            .textFieldStyle(.plain)
            .modifier(XgentFieldSurface(rounded: true, node: input, active: focused))
            .focused($focused)
            .onSubmit(send)
            .accessibilityIdentifier(input.id)
            .accessibilityLabel(input.accessibilityLabel ?? input.label ?? "")
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.webSearch)
            .submitLabel(.go)
            #endif
    }

    private var action: some View {
        Button(action: send) {
            if submit.kind == .iconButton { XgentControlIcon(name: submit.icon ?? "arrow.right").accessibilityHidden(true) }
            else { Text(submit.label ?? "") }
        }
        .buttonStyle(XgentActionButtonStyle(node: submit, iconOnly: submit.kind == .iconButton))
        .disabled(submit.disabled == true || model.isBusy(submit, in: document) || !allowsEmpty && text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .accessibilityIdentifier(submit.id)
        .accessibilityLabel(submit.label ?? "")
    }

    var body: some View {
        HStack(spacing: 6) { field.frame(minWidth: 80, maxWidth: .infinity); action }
            .disabled(input.disabled == true)
            .onChange(of: focusRequest) { _, _ in if !allowsEmpty { focused = true } }
    }
}

struct XgentBrowserAddressEntry: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        if let input = node.children?.first(where: { $0.kind == .textInput }),
           let submit = node.children?.first(where: { $0.kind == .button || $0.kind == .iconButton }) {
            XgentBrowserAddressField(input: input, submit: submit, document: document, model: model,
                                     allowsEmpty: node.variant == "browser-home-row")
                .frame(maxWidth: .infinity)
                .environment(\.xgentSettingsRow, false)
        }
    }
}
