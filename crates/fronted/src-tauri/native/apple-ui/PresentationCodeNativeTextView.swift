import SwiftUI
#if os(iOS)
import UIKit

@MainActor
final class XgentCodeNativeTextView: UITextView {
    // UIKit's text-input system records edits on its native responder manager.
    // The retained per-file hosting controller supplies that responder boundary.
    // Overriding this accessor with an unrelated manager hides UIKit's records.
    private let detachedUndo = UndoManager()
    var fileUndo: UndoManager { undoManager ?? detachedUndo }
    var lineIndex = XgentCodeLineIndex("")
    override func draw(_ rect: CGRect) {
        super.draw(rect)
        XgentCodeLineNumbers.draw(in: self, visible: bounds, inset: CGPoint(x: textContainerInset.left, y: textContainerInset.top))
    }
}
#else
import AppKit

@MainActor
final class XgentCodeNativeTextView: NSTextView {
    let fileUndo = UndoManager()
    var lineIndex = XgentCodeLineIndex("")
    override var undoManager: UndoManager? { fileUndo }
    override func draw(_ rect: NSRect) {
        super.draw(rect)
        XgentCodeLineNumbers.draw(in: self, visible: visibleRect, inset: CGPoint(x: textContainerInset.width, y: textContainerInset.height))
    }
}
#endif
