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
    @StateObject private var fieldState = XgentComposerFieldState()

    private var value: Binding<String> {
        Binding(get: { model.value(node, in: document).text },
            set: { next in
                fieldState.recordComposition()
                guard next != model.value(node, in: document).text else { return }
                model.send(node, in: document, value: .string(next), editing: true)
            })
    }

    var body: some View {
        TextField(node.label ?? "", text: value, selection: $selection, axis: .vertical)
            .modifier(XgentComposerFocusModifier(node: node, document: document, model: model))
            .lineLimit(1...6).textFieldStyle(.plain)
            .modifier(XgentControlTypography(node: node)).padding(.vertical, 8)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            .onChange(of: selection) { _, next in
                fieldState.recordComposition()
                guard let next, case .selection(let range) = next.indices else { return }
                let text = value.wrappedValue
                guard range.lowerBound >= text.startIndex, range.upperBound <= text.endIndex else { return }
                model.reportComposerSelection(NSRange(range, in: text), text: text, node: node, in: document)
            }
            .onChange(of: node.focusRequest, initial: true) { applySelectionRequest() }
            .onKeyPress(keys: [.return, .tab, .upArrow, .downArrow, .escape], phases: [.down, .repeat]) { key in
                handleKey(key)
            }
            #if os(iOS)
            .introspect(.textField(axis: .vertical), on: .iOS(.v26)) { view in
                fieldState.field = view
                view.keyboardDismissMode = .interactive
                view.showsVerticalScrollIndicator = false
            }
            #else
            .introspect(.textField(axis: .vertical), on: .macOS(.v15, .v26)) { fieldState.field = $0 }
            #endif
    }

    private func handleKey(_ key: KeyPress) -> KeyPress.Result {
        guard node.disabled != true, !fieldState.composing else { return .ignored }
        if key.key == .return && fieldState.suppressReturn { return .ignored }
        guard let latest = model.documents.first(where: { $0.surface == document.surface }),
              let input = latest.node(id: node.id), input.action == node.action,
              input.selectionAction == node.selectionAction, input.disabled != true else { return .ignored }
        let text = model.value(input, in: latest).text
        let menu = latest.node(id: "composer-suggestions")
        let menuScope = menu?.value?.text.data(using: .utf8)
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [Any] }
        let currentCaret = fieldState.selection
        let currentMenu = menu != nil && text == input.value?.text && currentCaret?.length == 0
            && (menuScope?.last as? Int) == currentCaret?.location
        if let menu, currentMenu {
            let candidates = (menu.children ?? []).filter { $0.action != nil && $0.disabled != true }
            if !candidates.isEmpty && (key.key == .upArrow || key.key == .downArrow) {
                guard key.modifiers.intersection([.shift, .option, .control, .command]).isEmpty else { return .ignored }
                model.composerKeyboard.move(key.key == .downArrow ? 1 : -1, menu: menu, document: latest, model: model)
                return .handled
            }
            if (key.key == .tab || (key.key == .return && !key.modifiers.contains(.shift))), !candidates.isEmpty {
                if let id = model.composerKeyboard.selectedID(menu: menu, document: latest),
                   let chosen = candidates.first(where: { $0.id == id }) { model.send(chosen, in: latest) }
                return .handled
            }
            if key.key == .escape, let close = input.children?.first(where: { $0.id == "draft-keyboard-dismiss" }) {
                model.send(close, in: latest); return .handled
            }
        } else if menu != nil && (key.key == .return || key.key == .tab) && !key.modifiers.contains(.shift) {
            // A typed query has not reached the business menu yet. Never send
            // its stale suggestion or the whole message by accident.
            return .handled
        }
        guard key.key == .return else { return .ignored }
        if key.modifiers.contains(.shift) {
            fieldState.insertLineBreak(); return .handled
        }
        let steer = key.modifiers.contains(.control) || key.modifiers.contains(.command)
        guard let submit = input.children?.first(where: { $0.id == (steer ? "draft-keyboard-steer" : "draft-keyboard-submit") }),
              submit.disabled != true else { return .ignored }
        model.send(submit, in: latest, value: .string(text))
        return .handled
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
