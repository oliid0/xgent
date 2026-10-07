#if os(iOS)
import UIKit

// UITextView's internal typing history can be cleared when a file loses its
// responder. Keep committed typing with the file-owned manager instead.
@MainActor
final class XgentCodeUndoHistory {
    private var previous: String
    private var selection = NSRange(location: 0, length: 0)
    private let replacement = XgentCodeReplacement()

    init(_ source: String) { previous = source }

    func reset(_ source: String, selection: NSRange) {
        previous = source
        self.selection = selection
    }

    func changed(_ view: XgentCodeNativeTextView) {
        guard view.markedTextRange == nil else { return }
        let current = view.text ?? ""
        let before = previous, caret = selection
        previous = current
        selection = view.selectedRange
        let manager = view.fileUndo
        guard current != before, manager.isUndoRegistrationEnabled,
              !manager.isUndoing, !manager.isRedoing else { return }
        manager.registerUndo(withTarget: replacement) { [weak view] target in
            guard let view else { return }
            target.restoreTyping(in: view, expected: current, previous: before, selection: caret)
        }
    }

    func selected(_ view: XgentCodeNativeTextView) {
        // UIKit reports selection before its final character-change callback.
        // Do not replace the pre-edit caret with that new caret.
        if view.text == previous { selection = view.selectedRange }
    }
}
#endif
