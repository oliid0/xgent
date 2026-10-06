import SwiftUI

// Native selection reports drive the same @file and /skill menus as the web
// composer. They are separate from text edits so an ACK cannot erase a draft.
struct XgentComposerInput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @StateObject private var fieldState = XgentComposerFieldState()

    private var value: String { model.value(node, in: document).text }

    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var scale = 1.0

    private var fontSize: CGFloat {
        let small = node.size == "small" || (node.size == nil && node.variant == "compact")
        #if os(iOS)
        let size = small ? 15.0 : 17.0
        #else
        let size = small ? theme.typography.supporting : theme.typography.body
        #endif
        return CGFloat(size * theme.fontScale) * scale
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if value.isEmpty {
                Text(node.label ?? "")
                    .font(XgentFonts.body(theme.fontFamily, size: fontSize))
                    .foregroundStyle(Color(xgentHex: theme.palette(for: colorScheme).secondaryText))
                    .padding(.vertical, 8).allowsHitTesting(false).accessibilityHidden(true)
            }
            XgentComposerNativeField(configuration: XgentComposerFieldConfiguration(
                readText: { value }, canonicalText: node.value?.text ?? "",
                references: node.children?.first { $0.id == "draft-inline-references" }?.text ?? "[]",
                readReferences: { model.composerReferences(node, in: document) },
                pasteRules: node.children?.first { $0.id == "draft-paste-rules" }?.text ?? "",
                selectionRequest: node.text, focusRequest: node.focusRequest,
                lease: "\(document.surface):\(node.action ?? ""):\(node.selectionAction ?? ""):\(node.editAction ?? "")",
                label: node.accessibilityLabel ?? node.label ?? "", identifier: node.id,
                disabled: node.disabled == true, fontFamily: theme.fontFamily, fontSize: fontSize,
                palette: theme.palette(for: colorScheme), fieldState: fieldState,
                consumeFocus: { model.consumeFocusRequest(node, in: document) },
                edit: { model.sendComposerEdit(text: $0, references: $1, pastes: $2, node: node, in: document) },
                select: { model.reportComposerSelection($0, text: $1, node: node, in: document) },
                key: handleKey))
        }
    }
    private func handleKey(_ key: XgentComposerKey) -> KeyPress.Result {
        guard node.disabled != true, !fieldState.composing else { return .ignored }
        if key.key == .return && fieldState.suppressReturn { return .ignored }
        guard let latest = model.documents.first(where: { $0.surface == document.surface }),
              let input = latest.node(id: node.id), input.action == node.action,
              input.selectionAction == node.selectionAction, input.editAction == node.editAction,
              input.disabled != true else { return .ignored }
        let text = model.value(input, in: latest).text
        let atomicKey: String? = key.key == .leftArrow ? "left" : key.key == .rightArrow ? "right"
            : key.key == .delete || key.key == KeyEquivalent("\u{7f}") ? "backspace"
            : key.key == .deleteForward ? "delete" : nil
        if let atomicKey, key.modifiers.intersection([.shift, .option, .control, .command]).isEmpty,
           let caret = fieldState.selection,
           !fieldState.hasReference(for: atomicKey, caret: caret),
           let action = input.children?.first(where: { $0.id == "draft-keyboard-atomic-\(atomicKey)" }),
           action.disabled != true,
           XgentComposerTokens.range(for: atomicKey, caret: caret, text: text,
                                     encoded: action.value?.text ?? "") != nil {
            // A preceding edit must be delivered before these ranges can own
            // another key. Ordinary text/selection/modifier keys stay native.
            guard text == input.value?.text, !model.isBusy(action, in: latest) else { return .handled }
            guard let data = try? JSONSerialization.data(withJSONObject: [
                "text": text, "location": caret.location, "length": caret.length
            ]), let payload = String(data: data, encoding: .utf8) else { return .ignored }
            model.send(action, in: latest, value: .string(payload))
            return .handled
        }
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
        if menu == nil, key.key == .upArrow || key.key == .downArrow {
            guard key.modifiers.intersection([.shift, .option, .control, .command]).isEmpty,
                  let caret = currentCaret, caret.length == 0 else { return .ignored }
            let previous = key.key == .upArrow
            let boundary = fieldState.historyBoundary(previous: previous)
            guard boundary, let history = input.children?.first(where: {
                $0.id == "draft-keyboard-history-\(previous ? "prev" : "next")"
            }), history.disabled != true else { return .ignored }
            // Wait for pending text delivery rather than recalling from an old
            // draft or moving the caret while its history request is in flight.
            guard text == input.value?.text, !model.isBusy(history, in: latest) else { return .handled }
            guard let data = try? JSONSerialization.data(withJSONObject: [
                "text": text, "location": caret.location, "length": caret.length
            ]), let payload = String(data: data, encoding: .utf8) else { return .ignored }
            model.send(history, in: latest, value: .string(payload))
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

}
