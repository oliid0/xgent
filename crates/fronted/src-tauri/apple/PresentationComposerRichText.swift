import Foundation

struct XgentComposerReference: Codable, Equatable {
    let id: String
    let location: Int
    let length: Int
    let label: String
    let icon: String
    func ownsSameRange(as other: Self) -> Bool {
        id == other.id && location == other.location && length == other.length
    }
}

struct XgentComposerPaste: Encodable { let id: String }

struct XgentComposerSnapshot: Encodable {
    let text: String
    let references: [XgentComposerReference]
    let pastes: [XgentComposerPaste]
    init(text: String, references: [XgentComposerReference], pastes: [XgentComposerPaste] = []) {
        self.text = text; self.references = references; self.pastes = pastes
    }
}

struct XgentComposerPasteRules: Decodable {
    let scope: String
    let label: String
    let minimumCharacters: Int
    let minimumLines: Int
    func contains(_ text: String) -> Bool {
        guard !scope.isEmpty, !label.isEmpty, minimumCharacters > 0, minimumLines > 0 else { return false }
        return text.utf16.count >= minimumCharacters || (!text.isEmpty && text.split(separator: "\n", omittingEmptySubsequences: false).count >= minimumLines)
    }
}

// The wire draft remains unchanged. Each native attachment occupies one UTF-16
// unit, while its original reference can occupy many (or contain emoji/newlines).
// All text edits, selections, copying and keyboard actions use this mapping.
struct XgentComposerRichText {
    struct Span {
        let native: NSRange
        let plain: NSRange
        let reference: XgentComposerReference?
    }
    let text: String
    let nativeLength: Int
    let spans: [Span]
    let pastes: [XgentComposerPaste]

    static func references(text: String, encoded: String) -> [XgentComposerReference] {
        guard let data = encoded.data(using: .utf8),
              let values = try? JSONDecoder().decode([XgentComposerReference].self, from: data) else { return [] }
        var end = 0
        for value in values {
            guard !value.id.isEmpty, value.location >= end, value.length > 0, !value.label.isEmpty,
                  value.location <= text.utf16.count, value.length <= text.utf16.count - value.location,
                  XgentComposerRange.isValid(NSRange(location: value.location, length: value.length), in: text) else { return [] }
            end = value.location + value.length
        }
        return values
    }

    init(_ value: NSAttributedString) {
        var plain = "", pieces: [Span] = [], pastes: [XgentComposerPaste] = []
        value.enumerateAttributes(in: NSRange(location: 0, length: value.length)) { attributes, range, _ in
            let reference = range.length == 1 && (value.string as NSString).substring(with: range) == "\u{fffc}"
                ? attributes[.xgentComposerReference] as? XgentComposerReferenceValue : nil
            let content = reference?.text ?? (value.string as NSString).substring(with: range)
            if let previous = pieces.last {
                let needsSpace = previous.reference != nil
                    ? reference != nil || !Self.isBoundarySpace(content.unicodeScalars.first)
                    : reference != nil && !Self.isBoundarySpace(plain.unicodeScalars.last)
                if needsSpace {
                    pieces.append(Span(native: NSRange(location: range.location, length: 0),
                        plain: NSRange(location: plain.utf16.count, length: 1), reference: nil))
                    plain += " "
                }
            }
            let plainRange = NSRange(location: plain.utf16.count, length: content.utf16.count)
            pieces.append(Span(native: range, plain: plainRange, reference: reference.map {
                XgentComposerReference(id: $0.id, location: plainRange.location, length: plainRange.length,
                                       label: $0.label, icon: $0.icon)
            }))
            if let reference, reference.newPaste, !pastes.contains(where: { $0.id == reference.id }) {
                pastes.append(XgentComposerPaste(id: reference.id))
            }
            plain += content
        }
        text = plain; spans = pieces; nativeLength = value.length; self.pastes = pastes
    }

    private static func isBoundarySpace(_ scalar: Unicode.Scalar?) -> Bool {
        // ECMAScript \s, used by the existing shared DOM chip serializer.
        guard let value = scalar?.value else { return false }
        return (9...13).contains(value) || value == 32 || value == 0xA0 || value == 0x1680 ||
            (0x2000...0x200A).contains(value) || value == 0x2028 || value == 0x2029 ||
            value == 0x202F || value == 0x205F || value == 0x3000 || value == 0xFEFF
    }

    func plainRange(_ range: NSRange) -> NSRange? {
        guard range.location >= 0, range.length >= 0, range.location <= nativeLength,
              range.length <= nativeLength - range.location else { return nil }
        let start = plainOffset(range.location, preferFollowing: range.length > 0)
        let end = plainOffset(range.location + range.length, preferFollowing: false)
        let result = NSRange(location: start, length: end - start)
        return XgentComposerRange.isValid(result, in: text) ? result : nil
    }

    func nativeRange(_ range: NSRange) -> NSRange? {
        guard range.location >= 0, range.length >= 0, range.location <= text.utf16.count,
              range.length <= text.utf16.count - range.location, XgentComposerRange.isValid(range, in: text) else { return nil }
        let start = nativeOffset(range.location, trailing: false)
        let end = nativeOffset(range.location + range.length, trailing: range.length > 0)
        return NSRange(location: start, length: end - start)
    }

    private func plainOffset(_ offset: Int, preferFollowing: Bool) -> Int {
        for span in spans where span.native.length > 0 && offset >= span.native.location &&
            (preferFollowing ? offset < NSMaxRange(span.native) : offset <= NSMaxRange(span.native)) {
            if span.reference != nil {
                if offset == span.native.location { return span.plain.location }
                return NSMaxRange(span.plain)
            }
            return span.plain.location + offset - span.native.location
        }
        return text.utf16.count
    }

    private func nativeOffset(_ offset: Int, trailing: Bool) -> Int {
        for span in spans where offset >= span.plain.location && offset <= NSMaxRange(span.plain) {
            if span.native.length == 0 { return span.native.location }
            if span.reference != nil {
                if offset == NSMaxRange(span.plain) || (offset > span.plain.location && trailing) { return NSMaxRange(span.native) }
                return span.native.location
            }
            return span.native.location + offset - span.plain.location
        }
        return nativeLength
    }
}

final class XgentComposerReferenceValue: NSObject {
    let id: String
    let text: String
    let label: String
    let icon: String
    let newPaste: Bool
    init(id: String, text: String, label: String, icon: String, newPaste: Bool = false) {
        self.id = id; self.text = text; self.label = label; self.icon = icon; self.newPaste = newPaste
    }
}

extension NSAttributedString.Key {
    static let xgentComposerReference = NSAttributedString.Key("com.xgent.composer-reference")
}
