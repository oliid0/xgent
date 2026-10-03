import CodeEditorView
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// File-owned TextKit state survives the SwiftUI representable and hosting root.
// In particular, undo operations must continue to reference this same input.
@MainActor
final class XgentCodeNativeInput: NSObject {
    let view: XgentCodeNativeTextView
    #if os(macOS)
    let scroll = NSScrollView()
    private var scrollObserver: NSObjectProtocol?
    #endif
    private var text: Binding<String>?
    private var position: Binding<CodeEditor.Position>?
    private var updating = false
    private var storageObserver: NSObjectProtocol?
    private var changeQueued = false

    init(content: String) {
        let storage = NSTextContentStorage()
        let manager = NSTextLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 640, height: CGFloat.greatestFiniteMagnitude))
        storage.addTextLayoutManager(manager)
        manager.textContainer = container
        view = XgentCodeNativeTextView(frame: .zero, textContainer: container)
        super.init()
        view.lineIndex = XgentCodeLineIndex(content)
        #if os(iOS)
        view.text = content
        view.delegate = self
        view.autocorrectionType = .no
        view.autocapitalizationType = .none
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.keyboardDismissMode = .interactive
        view.contentInsetAdjustmentBehavior = .never
        view.textContainerInset = UIEdgeInsets(top: 8, left: 44, bottom: 8, right: 8)
        #else
        view.string = content
        view.delegate = self
        view.isRichText = false
        view.allowsUndo = true
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.isVerticallyResizable = true
        view.minSize = .zero
        view.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        view.textContainerInset = NSSize(width: 44, height: 8)
        scroll.borderType = .noBorder
        scroll.hasVerticalScroller = true
        scroll.documentView = view
        scroll.contentView.postsBoundsChangedNotifications = true
        scrollObserver = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification,
            object: scroll.contentView, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.savePosition() }
            }
        #endif
        view.fileUndo.removeAllActions()
        if let storage = (manager.textContentManager as? NSTextContentStorage)?.textStorage {
            storageObserver = NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification,
                object: storage, queue: .main) { [weak self, weak storage] _ in
                    MainActor.assumeIsolated {
                        guard storage?.editedMask.contains(.editedCharacters) == true else { return }
                        self?.scheduleChange()
                    }
                }
        }
    }

    deinit {
        if let storageObserver { NotificationCenter.default.removeObserver(storageObserver) }
        #if os(macOS)
        if let scrollObserver { NotificationCenter.default.removeObserver(scrollObserver) }
        #endif
    }

    func update(text: Binding<String>, position: Binding<CodeEditor.Position>, wrap: Bool,
                fontName: String?, fontSize: CGFloat, palette: XgentPalette, label: String) {
        updating = true
        defer { updating = false }
        self.text = text; self.position = position
        #if os(iOS)
        if view.text != text.wrappedValue {
            view.text = text.wrappedValue
            view.lineIndex = XgentCodeLineIndex(text.wrappedValue)
        }
        view.font = fontName.flatMap { UIFont(name: $0, size: fontSize) } ?? .monospacedSystemFont(ofSize: fontSize, weight: .regular)
        view.textColor = UIColor(Color(xgentHex: palette.text))
        view.backgroundColor = UIColor(Color(xgentHex: palette.surface))
        view.accessibilityLabel = label
        view.textContainer.widthTracksTextView = wrap
        view.textContainer.size.width = wrap ? max(1, view.bounds.width - 52) : CGFloat.greatestFiniteMagnitude
        #else
        if view.string != text.wrappedValue {
            view.string = text.wrappedValue
            view.lineIndex = XgentCodeLineIndex(text.wrappedValue)
        }
        view.font = fontName.flatMap { NSFont(name: $0, size: fontSize) } ?? .monospacedSystemFont(ofSize: fontSize, weight: .regular)
        view.textColor = NSColor(Color(xgentHex: palette.text))
        view.backgroundColor = NSColor(Color(xgentHex: palette.surface))
        view.setAccessibilityLabel(label)
        view.isHorizontallyResizable = !wrap
        view.autoresizingMask = wrap ? [.width] : []
        view.textContainer?.widthTracksTextView = wrap
        view.textContainer?.containerSize = NSSize(width: wrap ? max(1, scroll.contentSize.width - 88) : CGFloat.greatestFiniteMagnitude,
                                                 height: CGFloat.greatestFiniteMagnitude)
        scroll.hasHorizontalScroller = !wrap
        #endif
    }

    func retire() {
        text = nil; position = nil
        view.isEditable = false
        view.fileUndo.removeAllActions()
    }

    private func scheduleChange() {
        guard !updating, !changeQueued else { return }
        changeQueued = true
        // Native undo edits TextKit storage without necessarily invoking the
        // text-view delegate. Read the final input after the editing batch,
        // through the current mount's binding, never a captured old surface.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.changeQueued = false
            self.changed()
        }
    }

    private func changed() {
        guard !updating, view.isEditable, view.window != nil else { return }
        #if os(iOS)
        text?.wrappedValue = view.text ?? ""
        view.lineIndex = XgentCodeLineIndex(view.text ?? "")
        view.setNeedsDisplay()
        #else
        text?.wrappedValue = view.string
        view.lineIndex = XgentCodeLineIndex(view.string)
        view.needsDisplay = true
        #endif
        savePosition()
    }
    private func savePosition() {
        guard !updating, view.isEditable, view.window != nil else { return }
        #if os(iOS)
        position?.wrappedValue = .init(selections: [view.selectedRange], verticalScrollPosition: view.contentOffset.y)
        view.setNeedsDisplay()
        #else
        position?.wrappedValue = .init(selections: view.selectedRanges.map(\.rangeValue), verticalScrollPosition: scroll.contentView.bounds.origin.y)
        view.needsDisplay = true
        #endif
    }
}

#if os(iOS)
extension XgentCodeNativeInput: UITextViewDelegate {
    func textViewDidChange(_ textView: UITextView) { changed() }
    func textViewDidChangeSelection(_ textView: UITextView) { savePosition() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { savePosition() }
}
#else
extension XgentCodeNativeInput: NSTextViewDelegate {
    func textDidChange(_ notification: Notification) { changed() }
    func textViewDidChangeSelection(_ notification: Notification) { savePosition() }
}
#endif
