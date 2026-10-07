import Foundation
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
private typealias HighlightTestView = UIView
#else
import AppKit
private typealias HighlightTestView = NSView
#endif
@testable import XgentNativeUI

final class CodeFindHighlightingTests: XCTestCase {
    func testDecorationIndexRejectsInvalidAndSplitSurrogateRangesAndClipsVisibleFragments() {
        let index = XgentCodeFindDecorationIndex(.init(source: "😀catcat", matches: [
            .init(location: 0, length: 1), .init(location: 2, length: 3), .init(location: 5, length: 3),
            .init(location: -1, length: 3), .init(location: 2, length: Int.max), .init(location: 8, length: 0)],
            scopes: [.init(location: 0, length: 5), .init(location: 2, length: 6)], revision: 1))
        XCTAssertEqual(index.matches, [NSRange(location: 2, length: 6)])
        XCTAssertEqual(index.scopes, [NSRange(location: 0, length: 8)])
        XCTAssertEqual(index.matches(in: NSRange(location: 3, length: 1)), [NSRange(location: 3, length: 1)])
        XCTAssertTrue(index.containsMatch(NSRange(location: 5, length: 3)))
        XCTAssertFalse(index.containsMatch(NSRange(location: 5, length: 2)))
        XCTAssertEqual(index.matches(in: NSRange(location: NSNotFound, length: 1)), [])
        XCTAssertEqual(index.scopes(in: NSRange(location: 4, length: Int.max)), [])
        let source = String(repeating: "cat ", count: 5000)
        let large = XgentCodeFindDecorationIndex(.init(source: source,
            matches: (0..<5000).map { .init(location: $0 * 4, length: 3) }, scopes: [], revision: 2))
        XCTAssertEqual(large.matches(in: NSRange(location: 19996, length: 4)), [NSRange(location: 19996, length: 3)])
    }

    @MainActor func testMountedHighlightsPreserveSyntaxSourceAndUndoAndClearWhenSourceChanges() async throws {
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let source = "let first = \"cat\"\nlet second = \"cat\""
        model.update(try fixture(source))
        #if os(iOS)
        let host = UIHostingController(rootView: XgentRootLayout(model: model))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        let root = host.view!
        #else
        let host = NSHostingView(rootView: XgentRootLayout(model: model))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        let root = host
        #endif
        try await Task.sleep(nanoseconds: 500_000_000)
        let input = try XCTUnwrap(editor(in: root)), manager = try XCTUnwrap(input.textLayoutManager)
        let storage = try XCTUnwrap((manager.textContentManager as? NSTextContentStorage)?.textStorage)
        let ranges = [NSRange(location: 13, length: 3), NSRange(location: 32, length: 3)]
        validate(manager)
        let foreground = try XCTUnwrap(attributes(manager, at: 0)[.foregroundColor] as? NSObject)
        let original = NSAttributedString(attributedString: storage), priorUndo = input.undoManager?.canUndo
        let priorActions = actions.count, highlighting = XgentCodeFindHighlighting()
        highlighting.attach(input)
        highlighting.update(try configuration(source, ranges: ranges, scopes: [NSRange(location: 0, length: source.utf16.count)]), colorScheme: .light)
        validate(manager)
        for range in ranges { XCTAssertNotNil(attributes(manager, at: range.location)[.backgroundColor]) }
        XCTAssertTrue(foreground.isEqual(attributes(manager, at: 0)[.foregroundColor]))
        XCTAssertTrue(original.isEqual(to: storage), "Find drawing must not modify the attributed source")
        XCTAssertEqual(priorUndo, input.undoManager?.canUndo)
        XCTAssertEqual(priorActions, actions.count)
        #if os(iOS)
        input.becomeFirstResponder(); input.selectedRange = .zero; input.insertText("//")
        #else
        window.makeFirstResponder(input); input.setSelectedRange(.zero); input.insertText("//", replacementRange: .zero)
        #endif
        try await Task.sleep(nanoseconds: 150_000_000)
        validate(manager)
        XCTAssertNil(attributes(manager, at: ranges[0].location)[.backgroundColor], "Unacknowledged source must not retain old search decorations")
        let newer = XgentCodeFindHighlighting()
        newer.attach(input)
        newer.update(try configuration("//" + source, ranges: ranges.map { NSRange(location: $0.location + 2, length: $0.length) }), colorScheme: .light)
        highlighting.detach()
        validate(manager)
        XCTAssertNotNil(attributes(manager, at: ranges[0].location + 2)[.backgroundColor], "Retired owners must not remove another renderer's callback")
        newer.update(nil, colorScheme: .light); validate(manager)
        XCTAssertNil(attributes(manager, at: ranges[0].location + 2)[.backgroundColor])
        newer.detach(); validate(manager)
        XCTAssertNotNil(attributes(manager, at: 0)[.foregroundColor], "Removing search rendering must keep the package's syntax callback")
    }

    @MainActor private func validate(_ manager: NSTextLayoutManager) {
        guard let storage = manager.textContentManager as? NSTextContentStorage else { return }
        manager.ensureLayout(for: storage.documentRange)
        manager.enumerateTextLayoutFragments(from: storage.documentRange.location, options: []) { fragment in
            manager.renderingAttributesValidator?(manager, fragment); return true
        }
    }
    @MainActor private func attributes(_ manager: NSTextLayoutManager, at offset: Int) -> [NSAttributedString.Key: Any] {
        guard let storage = manager.textContentManager as? NSTextContentStorage,
              let location = storage.location(storage.documentRange.location, offsetBy: offset) else { return [:] }
        var result: [NSAttributedString.Key: Any] = [:]
        manager.enumerateRenderingAttributes(from: location, reverse: false) { _, attributes, range in
            if let native = XgentCodeTextKitRange.utf16(range, in: storage), NSLocationInRange(offset, native) { result = attributes }
            return false
        }
        let stored = offset < (storage.textStorage?.length ?? 0)
            ? storage.textStorage?.attributes(at: offset, effectiveRange: nil) ?? [:] : [:]
        return stored.merging(result) { _, rendered in rendered }
    }
    @MainActor private func editor(in view: HighlightTestView) -> XgentFindHighlightTextView? {
        if let input = view as? XgentFindHighlightTextView, input.isEditable { return input }
        return view.subviews.lazy.compactMap { self.editor(in: $0) }.first
    }
    private func configuration(_ source: String, ranges: [NSRange], scopes: [NSRange] = []) throws -> XgentCodeFindConfiguration {
        let labels = ["query", "replacement", "matchCase", "wholeWord", "regex", "selection", "preserveCase", "next", "previous", "replace", "replaceAll", "close", "invalid", "rejected", "noSelection"]
        let find: [String: Any] = ["identity": "test:1", "open": true, "replacing": false, "query": "cat", "replacement": "",
            "options": ["matchCase": false, "wholeWord": false, "regex": false, "selection": !scopes.isEmpty, "preserveCase": false],
            "count": ranges.count, "current": 0, "revision": 1, "invalid": false, "limited": false, "rejected": false, "hasSelection": !scopes.isEmpty,
            "labels": Dictionary(uniqueKeysWithValues: labels.map { ($0, $0) }),
            "decorations": ["source": source, "matches": ranges.map { ["location": $0.location, "length": $0.length] },
                            "scopes": scopes.map { ["location": $0.location, "length": $0.length] }, "revision": 1]]
        let data = try JSONSerialization.data(withJSONObject: ["find": find])
        return try XCTUnwrap(XgentCodeFindConfiguration.decode(String(decoding: data, as: UTF8.self)))
    }
    private func fixture(_ content: String) throws -> XgentDocument {
        let payload: [String: Any] = ["version": 1, "surface": "find-highlights", "revision": 1, "mode": "root", "title": "Find", "appearance": "system",
            "nodes": [["id": "file", "kind": "BrowserLayout", "fill": true, "children": [["id": "code", "kind": "TextArea", "label": "Example.swift",
                "language": "swift", "value": content, "action": "edit", "fill": true]]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
