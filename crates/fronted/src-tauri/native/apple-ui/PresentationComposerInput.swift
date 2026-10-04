import SwiftUI
import SwiftUIIntrospect

// Native selection reports drive the same @file and /skill menus as the web
// composer. They are separate from text edits so an ACK cannot erase a draft.
struct XgentComposerInput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var selection: TextSelection?
    @State private var appliedRequest = 0

    private var value: Binding<String> {
        Binding(get: { model.value(node, in: document).text },
            set: { model.send(node, in: document, value: .string($0), editing: true) })
    }

    var body: some View {
        TextField(node.label ?? "", text: value, selection: $selection, axis: .vertical)
            .modifier(XgentComposerFocusModifier(node: node, document: document, model: model))
            .lineLimit(1...6).textFieldStyle(.plain)
            .font(.body).padding(.vertical, 8)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            .onChange(of: selection) { _, next in
                guard let next, case .selection(let range) = next.indices else { return }
                let text = value.wrappedValue
                guard range.lowerBound >= text.startIndex, range.upperBound <= text.endIndex else { return }
                model.reportComposerSelection(NSRange(range, in: text), text: text, node: node, in: document)
            }
            .onChange(of: node.focusRequest, initial: true) { applySelectionRequest() }
            #if os(iOS)
            .introspect(.textField(axis: .vertical), on: .iOS(.v26)) { view in
                view.keyboardDismissMode = .interactive
                view.showsVerticalScrollIndicator = false
            }
            #endif
    }

    private func applySelectionRequest() {
        guard let encoded = node.text, let data = encoded.data(using: .utf8),
              let request = try? JSONDecoder().decode(SelectionRequest.self, from: data),
              request.request > appliedRequest, request.request == node.focusRequest,
              request.location >= 0, request.length >= 0,
              request.location <= value.wrappedValue.utf16.count,
              request.length <= value.wrappedValue.utf16.count - request.location,
              let range = Range(NSRange(location: request.location, length: request.length), in: value.wrappedValue) else { return }
        appliedRequest = request.request
        selection = TextSelection(range: range)
    }

    private struct SelectionRequest: Decodable {
        let request: Int
        let location: Int
        let length: Int
    }
}
