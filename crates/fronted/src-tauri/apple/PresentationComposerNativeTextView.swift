import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct XgentComposerKey {
    let key: KeyEquivalent
    let modifiers: EventModifiers

    static func character(_ character: String, modifiers: EventModifiers) -> Self? {
        let key: KeyEquivalent
        switch character {
        case "\r", "\n": key = .return
        case "\t", "\u{19}": key = .tab
        case "\u{1b}": key = .escape
        case "\u{7f}", "\u{8}": key = .delete
        case "\u{f728}": key = .deleteForward
        case "\u{f700}": key = .upArrow
        case "\u{f701}": key = .downArrow
        case "\u{f702}": key = .leftArrow
        case "\u{f703}": key = .rightArrow
        default: return nil
        }
        return Self(key: key, modifiers: modifiers)
    }
}

#if os(iOS)
@MainActor final class XgentComposerNativeTextView: UITextView {
    var onKey: ((XgentComposerKey) -> KeyPress.Result)?
    var onWindow: (() -> Void)?
    var onPaste: ((String) -> Bool)?
    var onPasteAttachments: (([XgentClipboardAttachment]) -> Bool)?
    var insertingLineBreak = false
    override func didMoveToWindow() { super.didMoveToWindow(); onWindow?() }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        for press in presses {
            guard let key = press.key else { continue }
            var modifiers: EventModifiers = []
            if key.modifierFlags.contains(.shift) { modifiers.insert(.shift) }
            if key.modifierFlags.contains(.alternate) { modifiers.insert(.option) }
            if key.modifierFlags.contains(.control) { modifiers.insert(.control) }
            if key.modifierFlags.contains(.command) { modifiers.insert(.command) }
            // HID usages are stable across keyboard layouts; printable text
            // and IME interpretation remain owned by UITextView.
            let equivalent: KeyEquivalent?
            switch key.keyCode.rawValue {
            case 40: equivalent = .return
            case 41: equivalent = .escape
            case 42: equivalent = .delete
            case 43: equivalent = .tab
            case 76: equivalent = .deleteForward
            case 79: equivalent = .rightArrow
            case 80: equivalent = .leftArrow
            case 81: equivalent = .downArrow
            case 82: equivalent = .upArrow
            default: equivalent = nil
            }
            if let equivalent, let result = onKey?(XgentComposerKey(key: equivalent, modifiers: modifiers)),
               case .handled = result { return }
        }
        super.pressesBegan(presses, with: event)
    }

    override func copy(_ sender: Any?) {
        guard selectedRange.length > 0 else { return }
        let projection = XgentComposerRichText(attributedText)
        if let range = projection.plainRange(selectedRange) {
            UIPasteboard.general.string = (projection.text as NSString).substring(with: range)
        }
    }
    override func cut(_ sender: Any?) {
        guard isEditable, selectedRange.length > 0 else { return }
        copy(sender)
        insertText("")
    }
    override func paste(_ sender: Any?) {
        guard isEditable else { return }
        if onPasteAttachments?(XgentClipboardAttachment.providers(UIPasteboard.general.itemProviders)) == true { return }
        guard let text = UIPasteboard.general.string else { return }
        if onPaste?(text) == true { return }
        insertText(text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n"))
    }

    override func paste(itemProviders: [NSItemProvider]) {
        guard isEditable else { return }
        let attachments = XgentClipboardAttachment.providers(itemProviders)
        if !attachments.isEmpty {
            // Files belong to the shared importer; never insert an untracked
            // native image into a disabled or retired conversation draft.
            _ = onPasteAttachments?(attachments)
            return
        }
        super.paste(itemProviders: itemProviders)
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), isEditable, onPasteAttachments != nil {
            return UIPasteboard.general.numberOfItems > 0
        }
        return super.canPerformAction(action, withSender: sender)
    }

    func insertComposerFragment(_ fragment: NSAttributedString) -> Bool {
        guard isEditable, markedTextRange == nil else { return false }
        let manager = undoManager
        manager?.beginUndoGrouping()
        defer { manager?.endUndoGrouping() }
        return replaceComposerFragment(in: selectedRange, with: fragment,
            selectionAfter: NSRange(location: selectedRange.location + fragment.length, length: 0))
    }

    @discardableResult private func replaceComposerFragment(in range: NSRange, with fragment: NSAttributedString,
                                                          selectionAfter: NSRange) -> Bool {
        guard isEditable, range.location >= 0, range.length >= 0, range.location <= textStorage.length,
              range.length <= textStorage.length - range.location,
              XgentComposerRange.isValid(range, in: textStorage.string) else { return false }
        let previous = textStorage.attributedSubstring(from: range), previousSelection = selectedRange
        let replaced = NSRange(location: range.location, length: fragment.length)
        undoManager?.registerUndo(withTarget: self) { target in
            MainActor.assumeIsolated {
                _ = target.replaceComposerFragment(in: replaced, with: previous, selectionAfter: previousSelection)
            }
        }
        textStorage.beginEditing(); textStorage.replaceCharacters(in: range, with: fragment); textStorage.endEditing()
        selectedRange = selectionAfter
        delegate?.textViewDidChange?(self)
        return true
    }
}
#else
@MainActor final class XgentComposerNativeTextView: NSTextView {
    var onKey: ((XgentComposerKey) -> KeyPress.Result)?
    var onWindow: (() -> Void)?
    var onPaste: ((String) -> Bool)?
    var onPasteAttachments: (([XgentClipboardAttachment]) -> Bool)?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { isEditable }
    override func mouseDown(with event: NSEvent) {
        if isEditable { window?.makeFirstResponder(self) }
        super.mouseDown(with: event)
    }
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); onWindow?() }
    override func keyDown(with event: NSEvent) {
        var modifiers: EventModifiers = []
        if event.modifierFlags.contains(.shift) { modifiers.insert(.shift) }
        if event.modifierFlags.contains(.option) { modifiers.insert(.option) }
        if event.modifierFlags.contains(.control) { modifiers.insert(.control) }
        if event.modifierFlags.contains(.command) { modifiers.insert(.command) }
        if let key = XgentComposerKey.character(event.charactersIgnoringModifiers ?? "", modifiers: modifiers),
           let result = onKey?(key), case .handled = result { return }
        super.keyDown(with: event)
    }
    override func copy(_ sender: Any?) {
        guard selectedRange().length > 0 else { return }
        let projection = XgentComposerRichText(attributedString())
        if let range = projection.plainRange(selectedRange()) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString((projection.text as NSString).substring(with: range), forType: .string)
        }
    }
    override func cut(_ sender: Any?) {
        guard isEditable, selectedRange().length > 0 else { return }
        copy(sender); _ = insertComposerFragment(NSAttributedString(string: ""))
    }
    override func paste(_ sender: Any?) {
        guard isEditable else { return }
        if onPasteAttachments?(XgentClipboardAttachment.pasteboard(.general)) == true { return }
        guard let text = NSPasteboard.general.string(forType: .string) else { return }
        if onPaste?(text) == true { return }
        insertText(text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n"), replacementRange: selectedRange())
    }

    // Restore attributed fragments and notify the shared draft on both undo
    // and redo. NSTextView's plain insertion path loses this declaration.
    func insertComposerFragment(_ fragment: NSAttributedString) -> Bool {
        guard isEditable, !hasMarkedText() else { return false }
        breakUndoCoalescing()
        let manager = undoManager
        manager?.beginUndoGrouping()
        defer { manager?.endUndoGrouping() }
        let range = selectedRange()
        return replaceComposerFragment(in: range, with: fragment,
            selectionAfter: NSRange(location: range.location + fragment.length, length: 0))
    }

    @discardableResult private func replaceComposerFragment(in range: NSRange, with fragment: NSAttributedString,
                                                           selectionAfter: NSRange) -> Bool {
        guard isEditable, let storage = textStorage,
              XgentComposerRange.isValid(range, in: storage.string) else { return false }
        let previous = storage.attributedSubstring(from: range), previousSelection = selectedRange()
        let replaced = NSRange(location: range.location, length: fragment.length)
        let manager = undoManager
        // As in XgentCodeReplacement, let this attributed inverse own the edit.
        // AppKit's automatic record would otherwise undo the same insertion twice.
        manager?.disableUndoRegistration()
        guard shouldChangeText(in: range, replacementString: fragment.string) else {
            manager?.enableUndoRegistration()
            return false
        }
        storage.beginEditing(); storage.replaceCharacters(in: range, with: fragment); storage.endEditing()
        setSelectedRange(selectionAfter)
        didChangeText()
        manager?.enableUndoRegistration()
        manager?.registerUndo(withTarget: self) { target in
            MainActor.assumeIsolated {
                _ = target.replaceComposerFragment(in: replaced, with: previous, selectionAfter: previousSelection)
            }
        }
        return true
    }
}
#endif
