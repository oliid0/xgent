import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// Input and its floating menu share local keyboard selection. Arrow keys never
// cross the transport; only choosing an existing result dispatches its action.
@MainActor final class XgentComposerKeyboardState: ObservableObject {
    private struct Selection { let scope: String; let id: String }
    @Published private var selections: [String: Selection] = [:]

    func selectedID(menu: XgentNode, document: XgentDocument) -> String? {
        let candidates = (menu.children ?? []).filter { $0.action != nil && $0.disabled != true }
        if let selected = selections[document.surface], selected.scope == menu.value?.text,
           candidates.contains(where: { $0.id == selected.id }) { return selected.id }
        return candidates.first?.id
    }

    func move(_ offset: Int, menu: XgentNode, document: XgentDocument, model: XgentPresentationModel) {
        let candidates = (menu.children ?? []).filter {
            $0.action != nil && $0.disabled != true && !model.isBusy($0, in: document)
        }
        guard !candidates.isEmpty else { return }
        let current = selectedID(menu: menu, document: document)
        let index = candidates.firstIndex { $0.id == current } ?? 0
        let next = candidates[(index + offset + candidates.count) % candidates.count]
        selections[document.surface] = Selection(scope: menu.value?.text ?? "", id: next.id)
    }

    func clear(surface: String? = nil) {
        if let surface { selections.removeValue(forKey: surface) }
        else { selections.removeAll() }
    }
}

@MainActor final class XgentComposerFieldState: ObservableObject {
    #if os(iOS)
    weak var field: UITextView?
    var composing: Bool { field?.markedTextRange != nil }
    var selection: NSRange? {
        guard let field else { return nil }
        return XgentComposerRichText(field.attributedText ?? NSAttributedString(string: "")).plainRange(field.selectedRange)
    }
    func insertLineBreak() {
        let native = field as? XgentComposerNativeTextView
        native?.insertingLineBreak = true
        defer { native?.insertingLineBreak = false }
        field?.insertText("\n")
    }
    #else
    weak var field: NSTextView?
    var composing: Bool { field?.hasMarkedText() == true }
    var selection: NSRange? {
        guard let field else { return nil }
        return XgentComposerRichText(field.attributedString()).plainRange(field.selectedRange())
    }
    func insertLineBreak() { field?.insertNewlineIgnoringFieldEditor(nil) }
    #endif

    private var previouslyComposing = false
    func historyBoundary(previous: Bool) -> Bool {
        guard let field else { return false }
        #if os(iOS)
        let text = field.text ?? "", caret = field.selectedRange
        #else
        let text = field.string, caret = field.selectedRange()
        #endif
        guard caret.length == 0, XgentComposerRange.isValid(caret, in: text),
              let range = Range(caret, in: text) else { return false }
        return previous ? !text[..<range.lowerBound].contains("\n") : !text[range.upperBound...].contains("\n")
    }
    func hasReference(for key: String, caret: NSRange) -> Bool {
        guard caret.length == 0, let field else { return false }
        #if os(iOS)
        let text = field.attributedText ?? NSAttributedString(string: "")
        #else
        let text = field.attributedString()
        #endif
        let backward = key == "left" || key == "backspace"
        return XgentComposerRichText(text).spans.contains { span in
            span.reference != nil && (backward
                ? caret.location > span.plain.location && caret.location <= NSMaxRange(span.plain)
                : caret.location >= span.plain.location && caret.location < NSMaxRange(span.plain))
        }
    }
    private var compositionEndedAt: TimeInterval = -.infinity
    func recordComposition() {
        let current = composing
        if previouslyComposing && !current { compositionEndedAt = Date.timeIntervalSinceReferenceDate }
        previouslyComposing = current
    }
    var suppressReturn: Bool {
        recordComposition()
        return composing || Date.timeIntervalSinceReferenceDate - compositionEndedAt < 0.08
    }
}
