import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class ComposerReferenceRenderingTests: XCTestCase {
    @MainActor func testRestylingPreservesVirtualChipMarginsAndTheNativeRangesOwnedByUndo() {
        let value = NSMutableAttributedString(string: "word\u{fffc}next")
        value.addAttribute(.xgentComposerReference,
            value: XgentComposerReferenceValue(id: "skill", text: "/review", label: "/review", icon: "sparkles"),
            range: NSRange(location: 4, length: 1))
        let projection = XgentComposerRichText(value)
        let restyled = XgentComposerAttributedText.make(text: projection.text,
            references: projection.spans.compactMap(\.reference), fontFamily: nil, fontSize: 24,
            palette: XgentPresentationTheme.fallback.dark, width: 240, preserving: value)
        XCTAssertEqual(restyled.string, value.string, "Restyling must not turn virtual chip margins into new editable characters")
        XCTAssertEqual(XgentComposerRichText(restyled).text, "word /review next")
        XCTAssertNotNil(restyled.attribute(.attachment, at: 4, effectiveRange: nil))
        XCTAssertTrue(XgentComposerAttributedText.matchesStyle(restyled, fontFamily: nil,
            fontSize: 24, palette: XgentPresentationTheme.fallback.dark, width: 240))
        XCTAssertFalse(XgentComposerAttributedText.matchesStyle(restyled, fontFamily: nil,
            fontSize: 17, palette: XgentPresentationTheme.fallback.light, width: 240),
            "An attributed undo record restored under a different theme/font must be restyled")
    }

    @MainActor func testLargeClipboardTextUsesANativeUndoableCardAndCarriesItsSharedPasteDeclaration() async throws {
        let document = try fixture(), model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let content = XgentComposerInput(node: document.nodes[0], document: document, model: model)
            .frame(width: 240).frame(height: 220, alignment: .top).dynamicTypeSize(.large)
        let source = String(repeating: "😀 line\r\n", count: 1000)
        let expected = source.replacingOccurrences(of: "\r\n", with: "\n")
        #if os(iOS)
        let host = UIHostingController(rootView: content)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 240, height: 220))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(220))
        func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap { descendants($0) } }
        let field = try XCTUnwrap(descendants(host.view).compactMap { $0 as? XgentComposerNativeTextView }.first)
        field.selectedRange = NSRange(location: field.attributedText.length, length: 0)
        let originalLength = field.attributedText.length
        UIPasteboard.general.string = source
        #else
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 240, height: 220),
            styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer {
            print("composer-long-paste: teardown begin")
            model.invalidate(); window.close()
            print("composer-long-paste: teardown complete")
        }
        host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(220))
        func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap { descendants($0) } }
        let field = try XCTUnwrap(descendants(host).compactMap { $0 as? XgentComposerNativeTextView }.first)
        field.setSelectedRange(NSRange(location: field.string.utf16.count, length: 0))
        let originalLength = field.string.utf16.count
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(source, forType: .string)
        #endif
        print("composer-long-paste: paste begin")
        field.paste(nil); try await Task.sleep(for: .milliseconds(120))
        print("composer-long-paste: paste complete")
        let edit = try XCTUnwrap(actions.last { $0.action == "references" })
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(edit.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(payload["text"] as? String, "😀 /review /review tail " + expected)
        let references = try XCTUnwrap(payload["references"] as? [[String: Any]])
        let pastes = try XCTUnwrap(payload["pastes"] as? [[String: Any]])
        XCTAssertEqual(references.count, 3)
        XCTAssertEqual(pastes.count, 1)
        let id = try XCTUnwrap(pastes.first?["id"] as? String)
        XCTAssertTrue(id.hasPrefix("paste-test:paste-"))
        XCTAssertEqual(references.last?["id"] as? String, id)
        XCTAssertEqual(references.last?["length"] as? Int, expected.utf16.count)
        #if os(iOS)
        XCTAssertEqual(field.attributedText.length, originalLength + 1)
        field.selectedRange = NSRange(location: originalLength, length: 1); field.copy(nil)
        XCTAssertEqual(UIPasteboard.general.string, expected)
        #else
        XCTAssertEqual(field.string.utf16.count, originalLength + 1)
        field.setSelectedRange(NSRange(location: originalLength, length: 1)); field.copy(nil)
        XCTAssertEqual(NSPasteboard.general.string(forType: .string), expected)
        #endif
        let undo = try XCTUnwrap(field.undoManager)
        XCTAssertTrue(undo.canUndo)
        print("composer-long-paste: undo begin, groups=\(undo.groupingLevel)")
        undo.undo(); try await Task.sleep(for: .milliseconds(120))
        print("composer-long-paste: undo complete, canRedo=\(undo.canRedo)")
        let restored = try XCTUnwrap(actions.last { $0.action == "references" })
        let restoredPayload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(restored.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(restoredPayload["text"] as? String, "😀 /review /review tail")
        XCTAssertEqual((restoredPayload["pastes"] as? [[String: Any]])?.count, 0)
        XCTAssertTrue(undo.canRedo, "Undo must preserve the pasted card's redo record")
        print("composer-long-paste: redo begin, groups=\(undo.groupingLevel)")
        undo.redo(); try await Task.sleep(for: .milliseconds(120))
        print("composer-long-paste: redo complete")
        let redone = try XCTUnwrap(actions.last { $0.action == "references" })
        let redonePayload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(redone.value.text.utf8)) as? [String: Any])
        XCTAssertEqual((redonePayload["pastes"] as? [[String: Any]])?.first?["id"] as? String, id)
        print("composer-long-paste: assertions complete")
    }

    @MainActor func testActualInlineCardsCopyDeleteAndUndoTheirOriginalReferences() async throws {
        let document = try fixture()
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let content = XgentComposerInput(node: document.nodes[0], document: document, model: model)
            .frame(width: 240).frame(height: 220, alignment: .top).dynamicTypeSize(.large)
        #if os(iOS)
        let host = UIHostingController(rootView: content)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 240, height: 220))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(220))
        func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap { descendants($0) } }
        let field = try XCTUnwrap(descendants(host.view).compactMap { $0 as? XgentComposerNativeTextView }.first)
        let value = try XCTUnwrap(field.attributedText)
        field.selectedRange = NSRange(location: 3, length: 1)
        field.copy(nil)
        XCTAssertEqual(UIPasteboard.general.string, "/review")
        #else
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 240, height: 220),
            styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(220))
        func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap { descendants($0) } }
        let field = try XCTUnwrap(descendants(host).compactMap { $0 as? XgentComposerNativeTextView }.first)
        let value = field.attributedString()
        field.setSelectedRange(NSRange(location: 3, length: 1))
        field.copy(nil)
        XCTAssertEqual(NSPasteboard.general.string(forType: .string), "/review")
        #endif
        let initial = XgentComposerRichText(value)
        XCTAssertEqual(initial.text, "😀 /review /review tail")
        XCTAssertEqual(value.string, "😀 \u{fffc} \u{fffc} tail")
        var attachments: [XgentComposerReferenceAttachment] = []
        value.enumerateAttribute(.attachment, in: NSRange(location: 0, length: value.length)) { attachment, _, _ in
            if let attachment = attachment as? XgentComposerReferenceAttachment { attachments.append(attachment) }
        }
        XCTAssertEqual(attachments.count, 2)
        for attachment in attachments {
            XCTAssertTrue(attachment.allowsTextAttachmentView)
            XCTAssertGreaterThanOrEqual(attachment.bounds.width, 44)
            XCTAssertLessThanOrEqual(attachment.bounds.width, field.bounds.width)
            XCTAssertLessThanOrEqual(attachment.bounds.width + attachment.lineLayoutPadding * 2, field.bounds.width)
            XCTAssertGreaterThan(attachment.bounds.height, 17)
        }
        // Copying exports the real prompt, while editing deletes one native unit.
        // Both displayed cards have the same label; their identities differ.
        field.cut(nil)
        try await Task.sleep(for: .milliseconds(120))
        let edit = try XCTUnwrap(actions.last { $0.action == "references" })
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(edit.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(payload["text"] as? String, "😀  /review tail")
        let references = try XCTUnwrap(payload["references"] as? [[String: Any]])
        XCTAssertEqual(references.count, 1)
        XCTAssertEqual(references.first?["id"] as? String, "second")
        XCTAssertEqual(references.first?["location"] as? Int, 4)
        XCTAssertEqual(model.value(document.nodes[0], in: document).text, "😀  /review tail",
            "The optimistic draft must contain prompt text rather than serialized JSON")
        let undo = try XCTUnwrap(field.undoManager)
        XCTAssertTrue(undo.canUndo, "Native deletion must retain its real attributed undo record")
        undo.undo(); try await Task.sleep(for: .milliseconds(120))
        let restored = try XCTUnwrap(actions.last { $0.action == "references" })
        let restoredPayload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(restored.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(restoredPayload["text"] as? String, initial.text)
        XCTAssertEqual((restoredPayload["references"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["first", "second"])
        XCTAssertFalse(actions.contains { $0.action == "legacy-edit" }, "Reference edits use their dedicated transport event")
    }

    @MainActor func testLongReferenceCardsStayInsideNarrowScaledNativeEditors() async throws {
        let base = XgentPresentationTheme.fallback
        for width in [240.0, 390.0] {
            for scale in [1.0, 1.4] {
                let document = try fixture(label: "A very long workspace folder with an emoji 😀 and a long file name.md")
                let model = XgentPresentationModel(); model.update(document)
                let theme = XgentPresentationTheme(light: base.light, dark: base.dark, radius: base.radius,
                    spacing: base.spacing, control: base.control, typography: base.typography,
                    motion: base.motion, material: base.material, fontScale: scale,
                    fontFamily: base.fontFamily, codeFontFamily: base.codeFontFamily)
                let content = XgentComposerInput(node: document.nodes[0], document: document, model: model)
                    .frame(width: width).frame(height: 220, alignment: .top)
                    .environment(\.xgentPresentationTheme, theme).dynamicTypeSize(.large)
                #if os(iOS)
                let host = UIHostingController(rootView: content)
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 220))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(160))
                func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap { descendants($0) } }
                let field = try XCTUnwrap(descendants(host.view).compactMap { $0 as? XgentComposerNativeTextView }.first)
                let value = try XCTUnwrap(field.attributedText)
                #else
                let host = NSHostingView(rootView: content)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 220),
                    styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                defer { model.invalidate(); window.close() }
                host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(160))
                func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap { descendants($0) } }
                let field = try XCTUnwrap(descendants(host).compactMap { $0 as? XgentComposerNativeTextView }.first)
                let value = field.attributedString()
                #endif
                let attachment = try XCTUnwrap(value.attribute(.attachment, at: 3, effectiveRange: nil) as? XgentComposerReferenceAttachment)
                XCTAssertLessThanOrEqual(attachment.bounds.width, CGFloat(width - 16))
                XCTAssertGreaterThan(attachment.bounds.height, 20)
                XCTAssertGreaterThan(field.bounds.height, attachment.bounds.height)
                XCTAssertEqual(XgentComposerRichText(value).text, document.nodes[0].value?.text)
            }
        }
    }

    private func fixture(label: String = "/review") throws -> XgentDocument {
        let references: [[String: Any]] = [
            ["id": "first", "location": 3, "length": 7, "label": label, "icon": "sparkles"],
            ["id": "second", "location": 11, "length": 7, "label": label, "icon": "sparkles"],
        ]
        let encoded = String(decoding: try JSONSerialization.data(withJSONObject: references), as: UTF8.self)
        let result = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "reference-editor", "revision": 1, "mode": "root", "title": "Chat", "appearance": "light",
            "nodes": [["id": "draft", "kind": "ComposerInput", "label": "Message", "value": "😀 /review /review tail",
                "action": "legacy-edit", "editAction": "references", "selectionAction": "selection", "focusRequest": 1,
                "text": "{\"request\":1,\"location\":23,\"length\":0}",
                "children": [["id": "draft-inline-references", "kind": "Text", "text": encoded],
                    ["id": "draft-paste-rules", "kind": "Text", "text": "{\"scope\":\"paste-test\",\"label\":\"Pasted text\",\"minimumCharacters\":8000,\"minimumLines\":200}"]]]],
        ]))
        try result.validate(); return result
    }
}
