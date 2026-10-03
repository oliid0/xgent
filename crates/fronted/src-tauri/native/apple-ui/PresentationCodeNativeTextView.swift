import SwiftUI
#if os(iOS)
import UIKit

@MainActor
final class XgentCodeNativeTextView: UITextView {
    let fileUndo = UndoManager()
    var lineIndex = XgentCodeLineIndex("")
    override var undoManager: UndoManager? { fileUndo }
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
