import Foundation
#if os(iOS)
import UIKit
private typealias XgentReplacementTextView = UITextView
#else
import AppKit
private typealias XgentReplacementTextView = NSTextView
#endif

// An exact storage edit avoids language completion/indentation changing the
// replacement. Register its inverse on the text view's actual undo manager.
@MainActor
final class XgentCodeReplacement {
    #if os(iOS)
    func apply(_ edit: XgentCodeFindEdit, to view: UITextView) -> Bool {
        replace(view, before: edit.before, range: edit.selection.range, with: edit.text)
    }
    func restoreTyping(in view: UITextView, expected: String, previous: String, selection: NSRange) {
        // Use the same exact TextKit edit as Find/Replace, including inverse
        // registration while undoing, instead of assigning UITextView.text.
        _ = replace(view, before: expected, range: NSRange(location: 0, length: expected.utf16.count),
                    with: previous, restoredSelection: selection)
    }
    #else
    func apply(_ edit: XgentCodeFindEdit, to view: NSTextView) -> Bool {
        replace(view, before: edit.before, range: edit.selection.range, with: edit.text)
    }
    #endif

    private func replace(_ view: XgentReplacementTextView, before: String, range: NSRange, with replacement: String,
                         restoredSelection: NSRange? = nil) -> Bool {
        guard view.window != nil, view.isEditable, let manager = view.undoManager,
              range.location != NSNotFound, range.location >= 0, range.length >= 0, range.location <= before.utf16.count,
              range.length <= before.utf16.count - range.location else { return false }
        #if os(iOS)
        guard view.text == before, view.markedTextRange == nil,
              view.delegate?.textView?(view, shouldChangeTextIn: range, replacementText: replacement) != false else { return false }
        let storage = view.textStorage
        let priorSelection = restoredSelection == nil ? nil : view.selectedRange
        #else
        guard view.string == before, !view.hasMarkedText(), let storage = view.textStorage else { return false }
        view.breakUndoCoalescing()
        #endif
        let prior = (before as NSString).substring(with: range)
        let after = (before as NSString).replacingCharacters(in: range, with: replacement)
        if after == before { return true }
        let inverse = NSRange(location: range.location, length: replacement.utf16.count)
        let grouping = !manager.isUndoing && !manager.isRedoing
        if grouping { manager.beginUndoGrouping() }
        manager.disableUndoRegistration()
        #if os(iOS)
        view.inputDelegate?.textWillChange(view)
        #else
        let allowed = view.shouldChangeText(in: range, replacementString: replacement)
        if !allowed {
            manager.enableUndoRegistration()
            if grouping { manager.endUndoGrouping() }
            return false
        }
        #endif
        storage.beginEditing()
        storage.replaceCharacters(in: range, with: replacement)
        storage.endEditing()
        #if os(iOS)
        if let restoredSelection {
            let start = min(max(0, restoredSelection.location), after.utf16.count)
            view.selectedRange = NSRange(location: start, length: min(max(0, restoredSelection.length), after.utf16.count - start))
        } else { view.selectedRange = inverse }
        view.inputDelegate?.textDidChange(view)
        view.delegate?.textViewDidChange?(view)
        view.scrollRangeToVisible(inverse)
        #else
        view.setSelectedRange(inverse)
        view.didChangeText()
        view.scrollRangeToVisible(inverse)
        #endif
        manager.enableUndoRegistration()
        manager.registerUndo(withTarget: self) { [weak view] target in
            guard let view else { return }
            #if os(iOS)
            _ = target.replace(view, before: after, range: inverse, with: prior, restoredSelection: priorSelection)
            #else
            _ = target.replace(view, before: after, range: inverse, with: prior)
            #endif
        }
        if grouping { manager.endUndoGrouping() }
        return true
    }
}
