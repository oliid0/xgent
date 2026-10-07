import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct XgentCodeEditingLabels: Decodable {
    let find: String
    let replace: String
    let copy: String
    let undo: String
    let redo: String

    static func decode(_ text: String?) -> Self? {
        struct Metadata: Decodable { let labels: XgentCodeEditingLabels }
        guard let data = text?.data(using: .utf8) else { return nil }
        return (try? JSONDecoder().decode(Metadata.self, from: data))?.labels
    }
}

@MainActor
final class XgentCodeEditingCommands: ObservableObject {
    @Published private(set) var attached = false
    #if os(iOS)
    private weak var target: UITextView?
    func attach(_ view: UITextView) {
        target = view
        view.isFindInteractionEnabled = true
        refresh(view)
    }
    #else
    private weak var target: NSTextView?
    func attach(_ view: NSTextView) {
        target = view
        view.usesFindBar = true
        view.isIncrementalSearchingEnabled = true
        refresh(view)
    }
    #endif

    private func refresh(_ view: AnyObject) {
        DispatchQueue.main.async { [weak self, weak view] in
            guard let self, let view, self.target === view else { return }
            let next = self.isAvailable
            if self.attached != next { self.attached = next }
        }
    }

    private var isAvailable: Bool {
        guard let view = target, let window = view.window, view.isEditable else { return false }
        #if os(iOS)
        return !window.isHidden
        #else
        return window.isVisible
        #endif
    }

    var canUndo: Bool { isAvailable && target?.undoManager?.canUndo == true }
    var canRedo: Bool { isAvailable && target?.undoManager?.canRedo == true }

    func snapshot() -> (content: String, selections: [XgentCodeFindRange])? {
        guard isAvailable, let view = target else { return nil }
        #if os(iOS)
        if view.markedTextRange != nil { view.unmarkText() }
        let source = view.text ?? "", ranges = [view.selectedRange]
        #else
        if view.hasMarkedText() { view.unmarkText() }
        let source = view.string, ranges = view.selectedRanges.map(\.rangeValue)
        #endif
        let selections = ranges.map { XgentCodeFindRange(location: $0.location, length: $0.length) }
        guard selections.allSatisfy({ $0.valid(in: source) }) else { return nil }
        return (source, selections)
    }

    func find(replacing: Bool, native: ((Bool) -> Void)? = nil) {
        guard isAvailable, let view = target else { return }
        if let native { native(replacing); return }
        #if os(iOS)
        view.becomeFirstResponder()
        view.findInteraction?.presentFindNavigator(showingReplace: replacing)
        #else
        view.window?.makeFirstResponder(view)
        let item = NSMenuItem()
        item.tag = Int((replacing ? NSTextFinder.Action.showReplaceInterface : .showFindInterface).rawValue)
        view.performTextFinderAction(item)
        #endif
    }

    func copy() {
        guard isAvailable, let view = target else { return }
        view.copy(nil)
    }
    func undo() {
        guard canUndo, focusTarget(), let view = target else { return }
        view.undoManager?.undo()
    }
    func redo() {
        guard canRedo, focusTarget(), let view = target else { return }
        view.undoManager?.redo()
    }

    private func focusTarget() -> Bool {
        guard isAvailable, let view = target else { return false }
        // Find fields own a different responder and undo history. Explicit
        // editor commands must target the editor's active editing session.
        #if os(iOS)
        return view.becomeFirstResponder()
        #else
        guard view.acceptsFirstResponder, let window = view.window else { return false }
        return window.makeFirstResponder(view) && window.firstResponder === view
        #endif
    }
}
