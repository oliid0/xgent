import SwiftUI
#if os(iOS)
import SwiftUIIntrospect
#endif

struct XgentDocumentAnnotationText: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @FocusState private var focused: Bool

    private var text: Binding<String> {
        Binding(get: { model.value(node, in: document).text }, set: { value in
            model.send(node, in: document, value: .string(XgentDocumentAnnotationDraft.boundedText(value)), editing: true)
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            XgentFieldLabel(node: node)
            TextEditor(text: text)
                .focused($focused)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.interactively)
                .modifier(XgentControlTypography(node: node))
                .modifier(XgentFieldSurface(node: node, active: focused))
                .frame(minHeight: 120, maxHeight: .infinity)
                .accessibilityIdentifier(node.id)
                .accessibilityLabel(node.label ?? "")
                #if os(iOS)
                .introspect(.textEditor, on: .iOS(.v26)) { view in
                    view.keyboardDismissMode = .interactive
                    view.adjustsFontForContentSizeCategory = true
                }
                #endif
            Text("\(model.value(node, in: document).text.utf16.count) / \(XgentDocumentAnnotationDraft.maximumLength)")
                .font(.caption).monospacedDigit().foregroundStyle(.secondary)
        }
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 160, maxHeight: .infinity)
        .disabled(node.disabled == true)
        .accessibilityElement(children: .contain)
    }
}
