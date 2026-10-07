import Foundation
import XCTest
@testable import XgentNativeUI

final class ComposerRichTextTests: XCTestCase {
    func testComposedCharactersCannotBeSplitByNativeSelectionOrReferenceRanges() {
        for text in ["😀", "e\u{301}", "👨‍👩‍👧‍👦", "🇨🇳"] {
            XCTAssertTrue(XgentComposerRange.isValid(NSRange(location: 0, length: text.utf16.count), in: text))
            XCTAssertTrue(XgentComposerRange.isValid(NSRange(location: text.utf16.count, length: 0), in: text))
            for offset in 1..<text.utf16.count {
                XCTAssertFalse(XgentComposerRange.isValid(NSRange(location: offset, length: 0), in: text))
                XCTAssertFalse(XgentComposerRange.isValid(NSRange(location: 0, length: offset), in: text))
            }
        }
    }
    func testOpaqueChipsHaveTheSharedWordBoundariesWithoutChangingNativeEditingUnits() {
        let value = NSMutableAttributedString(string: "word\u{fffc}next")
        value.addAttribute(.xgentComposerReference,
            value: XgentComposerReferenceValue(id: "skill", text: "/review", label: "/review", icon: "sparkles"),
            range: NSRange(location: 4, length: 1))
        let projection = XgentComposerRichText(value)
        XCTAssertEqual(projection.text, "word /review next")
        XCTAssertEqual(projection.spans.compactMap(\.reference).first?.location, 5)
        XCTAssertEqual(projection.plainRange(NSRange(location: 4, length: 1)), NSRange(location: 5, length: 7),
            "Copying only the card excludes the surrounding virtual spaces")
        XCTAssertEqual(projection.plainRange(NSRange(location: 5, length: 4)), NSRange(location: 13, length: 4))
        XCTAssertEqual(projection.plainRange(NSRange(location: 0, length: 9)), NSRange(location: 0, length: 17))
        XCTAssertEqual(projection.nativeRange(NSRange(location: 5, length: 7)), NSRange(location: 4, length: 1))
        XCTAssertEqual(projection.nativeRange(NSRange(location: 4, length: 1)), NSRange(location: 4, length: 0),
            "A virtual chip margin does not introduce an editable native character")
    }

    func testClipboardDeclarationsContainOnlyOriginalNewPasteIdentities() throws {
        let value = NSMutableAttributedString(string: "\u{fffc}")
        value.addAttribute(.xgentComposerReference,
            value: XgentComposerReferenceValue(id: "paste", text: "first\nsecond", label: "Pasted text", icon: "doc.on.clipboard", newPaste: true),
            range: NSRange(location: 0, length: 1))
        let projection = XgentComposerRichText(value)
        let encoded = try JSONEncoder().encode(XgentComposerSnapshot(text: projection.text,
            references: projection.spans.compactMap(\.reference), pastes: projection.pastes))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(payload["text"] as? String, "first\nsecond")
        let pastes = try XCTUnwrap(payload["pastes"] as? [[String: Any]])
        XCTAssertEqual(pastes.first?["id"] as? String, "paste")
        XCTAssertEqual(pastes.first?.count, 1, "The original body is serialized once in the prompt, rather than duplicated")
    }

    func testSelectionsAndReferenceSnapshotsUseOriginalUTF16Text() throws {
        let value = NSMutableAttributedString(string: "😀 \u{fffc} \u{fffc} tail")
        for (offset, id) in [(3, "first"), (5, "second")] {
            value.addAttribute(.xgentComposerReference,
                value: XgentComposerReferenceValue(id: id, text: "/review", label: "/review", icon: "sparkles"),
                range: NSRange(location: offset, length: 1))
        }
        let projection = XgentComposerRichText(value)
        XCTAssertEqual(projection.text, "😀 /review /review tail")
        let references = projection.spans.compactMap(\.reference)
        XCTAssertEqual(references.map(\.id), ["first", "second"])
        XCTAssertEqual(references.map(\.location), [3, 11])
        XCTAssertEqual(references.map(\.length), [7, 7])
        XCTAssertEqual(projection.plainRange(NSRange(location: 3, length: 1)), NSRange(location: 3, length: 7))
        XCTAssertEqual(projection.plainRange(NSRange(location: 6, length: 0)), NSRange(location: 18, length: 0))
        XCTAssertEqual(projection.nativeRange(NSRange(location: 11, length: 7)), NSRange(location: 5, length: 1))
        XCTAssertEqual(projection.nativeRange(NSRange(location: 14, length: 0)), NSRange(location: 5, length: 0))
        XCTAssertEqual(projection.nativeRange(NSRange(location: 14, length: 1)), NSRange(location: 5, length: 1))
        let data = try JSONEncoder().encode(XgentComposerSnapshot(text: projection.text, references: references))
        let snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(snapshot["text"] as? String, projection.text)
        XCTAssertEqual((snapshot["references"] as? [[String: Any]])?.last?["id"] as? String, "second")
    }

    func testInvalidGraphemeRangesAndLeakedTypingAttributesNeverCreateAReference() {
        let value = NSMutableAttributedString(string: "😀 ordinary \u{fffc}")
        value.addAttribute(.xgentComposerReference,
            value: XgentComposerReferenceValue(id: "leaked", text: "/wrong", label: "/wrong", icon: "sparkles"),
            range: NSRange(location: 3, length: 8))
        let projection = XgentComposerRichText(value)
        XCTAssertEqual(projection.text, value.string)
        XCTAssertTrue(projection.spans.compactMap(\.reference).isEmpty)
        for range in [NSRange(location: -1, length: 0), NSRange(location: 1, length: 0),
                      NSRange(location: 0, length: 1), NSRange(location: 0, length: Int.max)] {
            XCTAssertNil(projection.plainRange(range))
            XCTAssertNil(projection.nativeRange(range))
        }
    }

    func testMalformedReferenceDocumentsDoNotDecorateUnrelatedText() throws {
        let valid = XgentComposerReference(id: "file", location: 3, length: 7, label: "Report", icon: "doc")
        let text = "😀 /review"
        let encode: ([XgentComposerReference]) throws -> String = { values in
            String(decoding: try JSONEncoder().encode(values), as: UTF8.self)
        }
        XCTAssertEqual(XgentComposerRichText.references(text: text, encoded: try encode([valid])), [valid])
        for reference in [XgentComposerReference(id: "", location: 3, length: 7, label: "Report", icon: "doc"),
                          XgentComposerReference(id: "file", location: 0, length: 1, label: "Report", icon: "doc"),
                          XgentComposerReference(id: "file", location: 3, length: Int.max, label: "Report", icon: "doc")] {
            XCTAssertTrue(XgentComposerRichText.references(text: text, encoded: try encode([reference])).isEmpty)
        }
        XCTAssertTrue(XgentComposerRichText.references(text: text, encoded: try encode([valid, valid])).isEmpty)
    }
}
