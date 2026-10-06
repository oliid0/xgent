import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct XgentComposerFieldConfiguration {
    let readText: () -> String
    var text: String { readText() }
    let canonicalText: String
    let references: String
    let readReferences: () -> [XgentComposerReference]?
    let pasteRules: String
    let selectionRequest: String?
    let focusRequest: Int?
    let lease: String
    let label: String
    let identifier: String
    let disabled: Bool
    let fontFamily: String?
    let fontSize: CGFloat
    let palette: XgentPalette
    let fieldState: XgentComposerFieldState
    let consumeFocus: () -> Bool
    let edit: (String, [XgentComposerReference], [XgentComposerPaste]) -> Void
    let select: (NSRange, String) -> Void
    let key: (XgentComposerKey) -> KeyPress.Result
}

#if os(iOS)
struct XgentComposerNativeField: UIViewRepresentable {
    let configuration: XgentComposerFieldConfiguration
    func makeCoordinator() -> XgentComposerNativeCoordinator { XgentComposerNativeCoordinator(configuration) }
    func makeUIView(context: Context) -> XgentComposerNativeTextView {
        context.coordinator.configure(configuration)
        return context.coordinator.view
    }
    func updateUIView(_ view: XgentComposerNativeTextView, context: Context) { context.coordinator.configure(configuration) }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: XgentComposerNativeTextView, context: Context) -> CGSize? {
        context.coordinator.size(width: proposal.width ?? 320)
    }
    static func dismantleUIView(_ view: XgentComposerNativeTextView, coordinator: XgentComposerNativeCoordinator) { coordinator.retire() }
}
#else
struct XgentComposerNativeField: NSViewRepresentable {
    let configuration: XgentComposerFieldConfiguration
    func makeCoordinator() -> XgentComposerNativeCoordinator { XgentComposerNativeCoordinator(configuration) }
    func makeNSView(context: Context) -> NSScrollView {
        context.coordinator.configure(configuration)
        return context.coordinator.scroll
    }
    func updateNSView(_ view: NSScrollView, context: Context) { context.coordinator.configure(configuration) }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSScrollView, context: Context) -> CGSize? {
        context.coordinator.size(width: proposal.width ?? 320)
    }
    static func dismantleNSView(_ view: NSScrollView, coordinator: XgentComposerNativeCoordinator) { coordinator.retire() }
}
#endif

@MainActor final class XgentComposerNativeCoordinator: NSObject {
    let view: XgentComposerNativeTextView
    #if os(macOS)
    let scroll = NSScrollView()
    #endif
    private var configuration: XgentComposerFieldConfiguration
    private var updating = false
    private var retired = false
    private var pendingFocus = false
    private var appliedSelection = 0
    private var style = ""
    private var width: CGFloat = 320
    private let contentStorage: NSTextContentStorage

    init(_ configuration: XgentComposerFieldConfiguration) {
        self.configuration = configuration
        let storage = NSTextContentStorage(), manager = NSTextLayoutManager()
        contentStorage = storage
        let container = NSTextContainer(size: CGSize(width: 320, height: CGFloat.greatestFiniteMagnitude))
        storage.addTextLayoutManager(manager); manager.textContainer = container
        view = XgentComposerNativeTextView(frame: .zero, textContainer: container)
        super.init()
        container.lineFragmentPadding = 0
        view.delegate = self
        #if os(iOS)
        view.backgroundColor = .clear; view.keyboardDismissMode = .interactive
        view.showsVerticalScrollIndicator = false
        view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        view.contentInsetAdjustmentBehavior = .never
        #else
        view.drawsBackground = false; view.isRichText = true; view.importsGraphics = false
        view.allowsUndo = true; view.usesFontPanel = false
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticLinkDetectionEnabled = false
        view.isVerticallyResizable = true; view.isHorizontallyResizable = false
        view.autoresizingMask = [.width]
        view.textContainerInset = CGSize(width: 0, height: 8)
        scroll.borderType = .noBorder; scroll.drawsBackground = false
        scroll.hasVerticalScroller = false; scroll.hasHorizontalScroller = false
        scroll.documentView = view
        #endif
        view.onKey = { [weak self] key in
            guard let self, !self.retired else { return .ignored }
            return self.configuration.key(key)
        }
        view.onWindow = { [weak self] in self?.applyFocus() }
        view.onPaste = { [weak self] in self?.paste($0) ?? false }
    }

    private var attributed: NSAttributedString {
        #if os(iOS)
        view.attributedText ?? NSAttributedString(string: "")
        #else
        view.attributedString()
        #endif
    }
    private var selection: NSRange {
        get {
            #if os(iOS)
            view.selectedRange
            #else
            view.selectedRange()
            #endif
        }
        set {
            #if os(iOS)
            view.selectedRange = newValue
            #else
            view.setSelectedRange(newValue)
            #endif
        }
    }

    func configure(_ next: XgentComposerFieldConfiguration) {
        guard !retired else { return }
        updating = true; defer { updating = false }
        let leaseChanged = configuration.lease != next.lease
        if leaseChanged { appliedSelection = 0; pendingFocus = false; view.undoManager?.removeAllActions(); view.unmarkText() }
        configuration = next; next.fieldState.field = view
        view.isEditable = !next.disabled; view.isSelectable = !next.disabled
        #if os(iOS)
        view.accessibilityIdentifier = next.identifier; view.accessibilityLabel = next.label
        #else
        view.setAccessibilityIdentifier(next.identifier); view.setAccessibilityLabel(next.label)
        #endif
        if !next.fieldState.composing { refreshContent(force: leaseChanged); applySelection() }
        if next.consumeFocus() { pendingFocus = true }
        DispatchQueue.main.async { [weak self] in self?.applyFocus() }
    }

    private func refreshContent(force: Bool = false) {
        let current = XgentComposerRichText(attributed)
        let next = configuration
        let references = next.readReferences() ?? (next.text == next.canonicalText
            ? XgentComposerRichText.references(text: next.text, encoded: next.references)
            : current.text == next.text ? current.spans.compactMap(\.reference) : [])
        // Optimistic native edits already move their attachments. A transport
        // acknowledgement must not rebuild them or disturb undo/marked text.
        let nextStyle = "\(next.fontFamily ?? "")-\(next.fontSize)-\(next.palette.text)-\(next.palette.muted)-\(next.palette.border)-\(width)"
        guard force || current.text != next.text || current.spans.compactMap(\.reference) != references || style != nextStyle ||
            !XgentComposerAttributedText.matchesStyle(attributed, fontFamily: next.fontFamily, fontSize: next.fontSize,
                palette: next.palette, width: width) else { return }
        let saved = current.plainRange(selection)
        let value = XgentComposerAttributedText.make(text: next.text, references: references,
            fontFamily: next.fontFamily, fontSize: next.fontSize, palette: next.palette, width: width,
            pastes: current.text == next.text ? current.pastes : [], preserving: force ? nil : attributed)
        // Programmatic draft/history/owner changes can move every native range.
        // Keep attributed undo records only while their native text is unchanged.
        if value.string != attributed.string { view.undoManager?.removeAllActions() }
        #if os(iOS)
        view.textStorage.setAttributedString(value)
        view.font = XgentFonts.name(for: next.fontFamily).flatMap { UIFont(name: $0, size: next.fontSize) } ?? .systemFont(ofSize: next.fontSize)
        view.typingAttributes = [.font: view.font!, .foregroundColor: UIColor(Color(xgentHex: next.palette.text))]
        #else
        view.textStorage?.setAttributedString(value)
        view.font = XgentFonts.name(for: next.fontFamily).flatMap { NSFont(name: $0, size: next.fontSize) } ?? .systemFont(ofSize: next.fontSize)
        view.typingAttributes = [.font: view.font!, .foregroundColor: NSColor(Color(xgentHex: next.palette.text))]
        #endif
        style = nextStyle
        let projection = XgentComposerRichText(value)
        let safe = NSRange(location: min(saved?.location ?? 0, next.text.utf16.count), length: 0)
        selection = projection.nativeRange(saved ?? safe) ?? projection.nativeRange(safe) ?? NSRange(location: value.length, length: 0)
    }

    private func applySelection() {
        guard let encoded = configuration.selectionRequest, let data = encoded.data(using: .utf8),
              let request = try? JSONDecoder().decode(SelectionRequest.self, from: data),
              request.request > appliedSelection, request.request == configuration.focusRequest,
              let range = XgentComposerRichText(attributed).nativeRange(NSRange(location: request.location, length: request.length)) else { return }
        appliedSelection = request.request; selection = range
        #if os(iOS)
        if let selected = view.selectedTextRange { view.scrollRectToVisible(view.caretRect(for: selected.end), animated: false) }
        #else
        view.scrollRangeToVisible(range)
        #endif
    }
    private struct SelectionRequest: Decodable { let request: Int; let location: Int; let length: Int }

    private func applyFocus() {
        guard !retired, pendingFocus, !configuration.disabled, view.window != nil else { return }
        #if os(iOS)
        if view.becomeFirstResponder() { pendingFocus = false; view.undoManager?.levelsOfUndo = 100 }
        #else
        if view.window?.makeFirstResponder(view) == true { pendingFocus = false; view.undoManager?.levelsOfUndo = 100 }
        #endif
    }

    func size(width proposed: CGFloat) -> CGSize {
        let nextWidth = max(44, proposed)
        if width != nextWidth {
            updating = true; width = nextWidth
            if !configuration.fieldState.composing { refreshContent() }
            updating = false
        }
        let line = configuration.fontSize * 1.3
        #if os(iOS)
        let measured = view.sizeThatFits(CGSize(width: nextWidth, height: CGFloat.greatestFiniteMagnitude)).height
        let minimum = max(44, line + 16)
        #else
        view.frame.size.width = nextWidth
        view.textContainer?.containerSize.width = nextWidth
        var measured = line + 16
        if let manager = view.textLayoutManager, let range = manager.textContentManager?.documentRange {
            manager.ensureLayout(for: range)
            measured = manager.usageBoundsForTextContainer.height + 16
        }
        view.frame.size.height = measured
        let minimum = line + 16
        #endif
        return CGSize(width: nextWidth, height: max(minimum, min(line * 6 + 16, measured)))
    }

    private func changed() {
        guard !updating, !retired, !configuration.disabled else { return }
        configuration.fieldState.recordComposition()
        let projection = XgentComposerRichText(attributed)
        configuration.edit(projection.text, projection.spans.compactMap(\.reference), projection.pastes)
        reportSelection()
        view.invalidateIntrinsicContentSize()
    }
    private func paste(_ source: String) -> Bool {
        guard !retired, !configuration.disabled, !configuration.fieldState.composing,
              let data = configuration.pasteRules.data(using: .utf8),
              let rules = try? JSONDecoder().decode(XgentComposerPasteRules.self, from: data) else { return false }
        let text = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        guard rules.contains(text) else { return false }
        let id = "\(rules.scope):paste-\(UUID().uuidString)"
        let reference = XgentComposerReference(id: id, location: 0, length: text.utf16.count,
            label: rules.label, icon: "doc.on.clipboard")
        let fragment = XgentComposerAttributedText.make(text: text, references: [reference],
            fontFamily: configuration.fontFamily, fontSize: configuration.fontSize,
            palette: configuration.palette, width: width, pastes: [XgentComposerPaste(id: id)])
        #if os(iOS)
        return view.insertComposerFragment(fragment)
        #else
        view.insertText(fragment, replacementRange: selection)
        return true
        #endif
    }
    private func reportSelection() {
        guard !updating, !retired, !configuration.disabled else { return }
        let projection = XgentComposerRichText(attributed)
        // Attachment attributes must never become the attributes of the next
        // typed character or a pasted literal object-replacement character.
        view.typingAttributes = view.typingAttributes.filter { $0.key != .attachment && $0.key != .xgentComposerReference }
        if let range = projection.plainRange(selection) { configuration.select(range, projection.text) }
    }
    func retire() {
        retired = true; pendingFocus = false
        view.onKey = nil; view.onWindow = nil; view.onPaste = nil; view.delegate = nil; view.isEditable = false
    }
}

#if os(iOS)
extension XgentComposerNativeCoordinator: UITextViewDelegate {
    func textViewDidChange(_ textView: UITextView) { changed() }
    func textViewDidChangeSelection(_ textView: UITextView) { reportSelection() }
    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        if text == "\n", !view.insertingLineBreak, !configuration.fieldState.composing,
           case .handled = configuration.key(XgentComposerKey(key: .return, modifiers: [])) { return false }
        return !configuration.disabled && !retired
    }
}
#else
extension XgentComposerNativeCoordinator: NSTextViewDelegate {
    func textDidChange(_ notification: Notification) { changed() }
    func textViewDidChangeSelection(_ notification: Notification) { reportSelection() }
}
#endif
