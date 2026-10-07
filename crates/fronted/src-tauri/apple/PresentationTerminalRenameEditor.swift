import SwiftUI

struct XgentTerminalRenameEditor: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @FocusState private var focused: Bool

    private var fields: [XgentNode] { (node.children ?? []).flatMap { [$0] + ($0.children ?? []) } }
    private var input: XgentNode? { fields.first { $0.kind == .textInput } }
    private var submit: XgentNode? { fields.first { $0.id == "terminal-name-save" } }
    private var draft: String {
        guard let input else { return "" }
        return model.value(input, in: document).text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    @ViewBuilder private var actions: some View {
        HStack(spacing: 8) {
            if let submit {
                Button { send() } label: { Text(submit.label ?? "").modifier(XgentControlTypography(node: submit)) }
                    .buttonStyle(XgentActionButtonStyle(node: submit))
                    .disabled(draft.isEmpty || draft.utf16.count > 200 || submit.disabled == true || model.isBusy(submit, in: document))
                    .accessibilityIdentifier(submit.id)
            }
            ForEach(fields.filter { $0.kind == .button && $0.id != "terminal-name-save" }) { content($0) }
        }
    }

    private func send() {
        guard let input, let submit, input.disabled != true, submit.disabled != true,
              !draft.isEmpty, draft.utf16.count <= 200, !model.isBusy(submit, in: document) else { return }
        model.send(submit, in: document, value: .string(model.value(input, in: document).text))
    }

    @ViewBuilder var body: some View {
        if let input {
            VStack(alignment: .leading, spacing: 8) {
                XgentFieldLabel(node: input)
                TextField(input.label ?? "", text: Binding(
                    get: { model.value(input, in: document).text },
                    set: { model.send(input, in: document, value: .string($0), editing: true) }))
                    .textFieldStyle(.plain)
                    .modifier(XgentFieldSurface(node: input, active: focused))
                    .focused($focused)
                    .onSubmit(send)
                    .disabled(input.disabled == true)
                    .accessibilityIdentifier(input.id)
                    .accessibilityLabel(input.label ?? "")
                    #if os(iOS)
                    .submitLabel(.done)
                    #endif
                actions
            }
            .environment(\.xgentSettingsRow, false)
            .onAppear { focused = true }
        }
    }
}
