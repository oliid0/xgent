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
    #else
    func apply(_ edit: XgentCodeFindEdit, to view: NSTextView) -> Bool {
        replace(view, before: edit.before, range: edit.selection.range, with: edit.text)
    }
    #endif

    private func replace(_ view: XgentReplacementTextView, before: String, range: NSRange, with replacement: String) -> Bool {
        guard view.window != nil, view.isEditable, let manager = view.undoManager,
              range.location != NSNotFound, range.location >= 0, range.length >= 0, range.location <= before.utf16.count,
              range.length <= before.utf16.count - range.location else { return false }
        #if os(iOS)
        guard view.text == before, view.markedTextRange == nil,
              view.delegate?.textView?(view, shouldChangeTextIn: range, replacementText: replacement) != false else { return false }
        let storage = view.textStorage
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
        view.selectedRange = inverse
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
            _ = target.replace(view, before: after, range: inverse, with: prior)
        }
        if grouping { manager.endUndoGrouping() }
        return true
    }
}
