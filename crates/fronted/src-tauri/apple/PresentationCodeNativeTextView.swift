import SwiftUI
#if os(iOS)
import UIKit

@MainActor
final class XgentCodeNativeTextView: UITextView {
    // File history outlives responder changes and controller reparenting.
    // Native input changes register their inverse explicitly on this manager.
    let fileUndo = UndoManager()
    override var undoManager: UndoManager? { fileUndo }
    var lineIndex = XgentCodeLineIndex("")
    override func unmarkText() {
        super.unmarkText()
        delegate?.textViewDidChange?(self)
    }
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
