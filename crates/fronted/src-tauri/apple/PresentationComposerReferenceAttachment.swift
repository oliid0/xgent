import SwiftUI
#if os(iOS)
import UIKit
typealias XgentComposerAttachmentParent = UIView
#else
import AppKit
typealias XgentComposerAttachmentParent = NSView
#endif

// A SwiftUI badge hosted by TextKit, never a flattened screenshot or a WebView.
// Its original reference remains in a separate attribute for lossless editing.
final class XgentComposerReferenceAttachment: NSTextAttachment {
    let reference: XgentComposerReferenceValue
    let fontFamily: String?
    let fontSize: CGFloat
    let palette: XgentPalette
    let badgeSize: CGSize

    @MainActor init(reference: XgentComposerReferenceValue, fontFamily: String?, fontSize: CGFloat,
         palette: XgentPalette, maxWidth: CGFloat) {
        self.reference = reference; self.fontFamily = fontFamily; self.fontSize = fontSize; self.palette = palette
        #if os(iOS)
        let font = XgentFonts.name(for: fontFamily).flatMap { UIFont(name: $0, size: fontSize) } ?? .systemFont(ofSize: fontSize)
        #else
        let font = XgentFonts.name(for: fontFamily).flatMap { NSFont(name: $0, size: fontSize) } ?? .systemFont(ofSize: fontSize)
        #endif
        let width = (reference.label as NSString).size(withAttributes: [.font: font]).width + fontSize + 22
        badgeSize = CGSize(width: min(max(44, maxWidth), max(44, ceil(width))), height: ceil(fontSize + 10))
        super.init(data: nil, ofType: "com.xgent.composer-reference")
        bounds = CGRect(origin: CGPoint(x: 0, y: font.descender - 3), size: badgeSize)
        lineLayoutPadding = 4
        allowsTextAttachmentView = true
    }
    required init?(coder: NSCoder) { return nil }

    override func viewProvider(for parentView: XgentComposerAttachmentParent?, location: any NSTextLocation,
                               textContainer: NSTextContainer?) -> NSTextAttachmentViewProvider? {
        let provider = XgentComposerReferenceViewProvider(textAttachment: self, parentView: parentView,
            textLayoutManager: textContainer?.textLayoutManager, location: location)
        provider.tracksTextAttachmentViewBounds = true
        return provider
    }
}

private final class XgentComposerReferenceViewProvider: NSTextAttachmentViewProvider {
    override func loadView() {
        // TextKit's attachment overrides are not actor-isolated. Creating the
        // hosted SwiftUI view stays on the native text view's main actor.
        MainActor.assumeIsolated { loadBadgeView() }
    }
    @MainActor private func loadBadgeView() {
        guard let attachment = textAttachment as? XgentComposerReferenceAttachment else { return }
        let badge = XgentComposerReferenceBadge(attachment: attachment)
        #if os(iOS)
        let host = UIHostingController(rootView: badge)
        host.view.backgroundColor = .clear
        host.view.isUserInteractionEnabled = false
        host.view.frame = CGRect(origin: .zero, size: attachment.badgeSize)
        view = host.view
        hostingController = host
        #else
        let host = XgentComposerReferenceHostingView(rootView: badge)
        host.frame = CGRect(origin: .zero, size: attachment.badgeSize)
        view = host
        #endif
    }
    #if os(iOS)
    @MainActor private var hostingController: UIViewController?
    #endif
    override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation,
                                   textContainer: NSTextContainer?, proposedLineFragment: CGRect, position: CGPoint) -> CGRect {
        (textAttachment as? XgentComposerReferenceAttachment)?.bounds ?? .zero
    }
}

#if os(macOS)
// A reference is one selectable text unit, rather than an independent control.
// Its view must let TextKit own pointer placement, selection and dragging.
private final class XgentComposerReferenceHostingView: NSHostingView<XgentComposerReferenceBadge> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
#endif

private struct XgentComposerReferenceBadge: View {
    let attachment: XgentComposerReferenceAttachment
    @Environment(\.colorScheme) private var colorScheme
    private var isFile: Bool { ["folder", "doc"].contains(attachment.reference.icon) }
    private var referenceColor: Color {
        isFile ? Color(xgentHex: colorScheme == .dark ? "#93c5fd" : "#1d4ed8")
            : Color(xgentHex: attachment.palette.text)
    }
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: attachment.reference.icon).imageScale(.small)
            Text(attachment.reference.label).lineLimit(1).truncationMode(.middle)
        }
        .font(XgentFonts.body(attachment.fontFamily, size: attachment.fontSize))
        .foregroundStyle(referenceColor)
        .padding(.horizontal, 7)
        .frame(width: attachment.badgeSize.width, height: attachment.badgeSize.height)
        .background(isFile ? referenceColor.opacity(0.1) : Color(xgentHex: attachment.palette.muted),
                    in: RoundedRectangle(cornerRadius: 7))
        .overlay { RoundedRectangle(cornerRadius: 7).stroke(Color(xgentHex: attachment.palette.border), lineWidth: 0.5) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(attachment.reference.label)
        .accessibilityHint(attachment.reference.text)
    }
}

@MainActor enum XgentComposerAttributedText {
    static func matchesStyle(_ value: NSAttributedString, fontFamily: String?, fontSize: CGFloat,
                             palette: XgentPalette, width: CGFloat) -> Bool {
        #if os(iOS)
        let font = XgentFonts.name(for: fontFamily).flatMap { UIFont(name: $0, size: fontSize) } ?? .systemFont(ofSize: fontSize)
        let color = UIColor(Color(xgentHex: palette.text))
        #else
        let font = XgentFonts.name(for: fontFamily).flatMap { NSFont(name: $0, size: fontSize) } ?? .systemFont(ofSize: fontSize)
        let color = NSColor(Color(xgentHex: palette.text))
        #endif
        var matches = true
        value.enumerateAttributes(in: NSRange(location: 0, length: value.length)) { attributes, _, stop in
            #if os(iOS)
            let actualFont = attributes[.font] as? UIFont, actualColor = attributes[.foregroundColor] as? UIColor
            #else
            let actualFont = attributes[.font] as? NSFont, actualColor = attributes[.foregroundColor] as? NSColor
            #endif
            matches = actualFont?.fontName == font.fontName && actualFont?.pointSize == font.pointSize && actualColor?.isEqual(color) == true
            if let attachment = attributes[.attachment] as? XgentComposerReferenceAttachment {
                let captionSize = fontSize * 0.85
                #if os(iOS)
                let caption = XgentFonts.name(for: fontFamily).flatMap { UIFont(name: $0, size: captionSize) } ?? .systemFont(ofSize: captionSize)
                #else
                let caption = XgentFonts.name(for: fontFamily).flatMap { NSFont(name: $0, size: captionSize) } ?? .systemFont(ofSize: captionSize)
                #endif
                let labelWidth = (attachment.reference.label as NSString).size(withAttributes: [.font: caption]).width + captionSize + 22
                let expectedWidth = min(max(44, width - 16), max(44, ceil(labelWidth)))
                matches = matches && attachment.fontFamily == fontFamily && attachment.fontSize == captionSize &&
                    attachment.palette.text == palette.text && attachment.palette.muted == palette.muted &&
                    attachment.palette.border == palette.border && attachment.badgeSize.width == expectedWidth
            }
            if !matches { stop.pointee = true }
        }
        return matches
    }

    static func make(text: String, references: [XgentComposerReference], fontFamily: String?, fontSize: CGFloat,
                     palette: XgentPalette, width: CGFloat, pastes: [XgentComposerPaste] = [],
                     preserving native: NSAttributedString? = nil) -> NSAttributedString {
        #if os(iOS)
        let font = XgentFonts.name(for: fontFamily).flatMap { UIFont(name: $0, size: fontSize) } ?? .systemFont(ofSize: fontSize)
        let color = UIColor(Color(xgentHex: palette.text))
        #else
        let font = XgentFonts.name(for: fontFamily).flatMap { NSFont(name: $0, size: fontSize) } ?? .systemFont(ofSize: fontSize)
        let color = NSColor(Color(xgentHex: palette.text))
        #endif
        let projection = native.map { XgentComposerRichText($0) }
        let spans = projection?.spans.filter { $0.reference != nil } ?? []
        let preserve = projection?.text == text && spans.count == references.count &&
            zip(spans, references).allSatisfy { pair in pair.0.reference?.ownsSameRange(as: pair.1) == true }
        let result: NSMutableAttributedString
        if preserve, let native {
            result = NSMutableAttributedString(attributedString: native)
            result.addAttributes([.font: font, .foregroundColor: color], range: NSRange(location: 0, length: result.length))
        } else {
            result = NSMutableAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
        }
        // Replacing from the end keeps every authoritative UTF-16 range valid.
        for (index, reference) in references.enumerated().reversed() {
            let range = NSRange(location: reference.location, length: reference.length)
            guard XgentComposerRange.isValid(range, in: text) else { continue }
            let value = XgentComposerReferenceValue(id: reference.id, text: (text as NSString).substring(with: range), label: reference.label, icon: reference.icon,
                newPaste: pastes.contains { $0.id == reference.id })
            let attachment = XgentComposerReferenceAttachment(reference: value, fontFamily: fontFamily,
                fontSize: fontSize * 0.85, palette: palette, maxWidth: max(44, width - 16))
            let fragment = NSMutableAttributedString(attributedString: NSAttributedString(attachment: attachment))
            fragment.addAttributes([.font: font, .foregroundColor: color, .xgentComposerReference: value],
                                   range: NSRange(location: 0, length: fragment.length))
            result.replaceCharacters(in: preserve ? spans[index].native : range, with: fragment)
        }
        return result
    }
}
