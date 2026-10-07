import SwiftUI

// Settings search is an inline search field, rather than a labelled form row.
// Filtering and clearing use the same shared actions as the other clients.
struct XgentSettingsSearchField: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @FocusState private var focused: Bool

    private var value: Binding<String> {
        Binding(get: { model.value(node, in: document).text },
                set: { model.send(node, in: document, value: .string($0), editing: true) })
    }
    private var clear: XgentNode? { node.children?.first { $0.kind == .iconButton } }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(node.label ?? "", text: value)
                .textFieldStyle(.plain)
                .focused($focused)
                .accessibilityIdentifier(node.id)
                .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            if let clear, !value.wrappedValue.isEmpty {
                Button { model.send(clear, in: document); focused = true } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .disabled(clear.disabled == true || model.isBusy(clear, in: document))
                .accessibilityIdentifier(clear.id)
                .accessibilityLabel(clear.accessibilityLabel ?? clear.label ?? "")
            }
        }
        .modifier(XgentFieldSurface(node: node, active: focused, tracksFocus: false))
        .disabled(node.disabled == true)
        .accessibilityElement(children: .contain)
        #if os(macOS)
        .onExitCommand { if let clear, clear.disabled != true { model.send(clear, in: document) } }
        #else
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        #endif
    }
}
