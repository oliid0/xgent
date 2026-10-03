import Foundation
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
private typealias SyntaxTestView = UIView
private typealias SyntaxTestColor = UIColor
#else
import AppKit
private typealias SyntaxTestView = NSView
private typealias SyntaxTestColor = NSColor
#endif
@testable import XgentNativeUI

final class CodeSyntaxTests: XCTestCase {
    func testPendingLexicalResultsKeepOnlyCompleteUnchangedLines() {
        let expected = "const emoji = '😀';\r\n/* comment\nconst later = 42;"
        let prefix = "const emoji = '😀';\r\n".utf16.count
        var source = XgentCodeSyntaxSource(expected)
        XCTAssertTrue(source.synchronize(expected)); XCTAssertTrue(source.exact)
        XCTAssertEqual(source.length, expected.utf16.count)
        XCTAssertTrue(source.synchronize(expected.replacingOccurrences(of: "/* comment", with: "// comment")))
        XCTAssertFalse(source.exact); XCTAssertEqual(source.length, prefix)
        XCTAssertEqual(source.clip(NSRange(location: 0, length: expected.utf16.count)), NSRange(location: 0, length: prefix))
        XCTAssertNil(source.clip(NSRange(location: prefix, length: 1)))
        XCTAssertNil(source.clip(NSRange(location: NSNotFound, length: 1)))
        XCTAssertFalse(source.synchronize("//" + expected)); XCTAssertEqual(source.length, 0)
        XCTAssertTrue(source.synchronize(expected)); XCTAssertTrue(source.exact)
        XCTAssertFalse(source.synchronize(nil)); XCTAssertEqual(source.length, 0)
    }

    func testCompactSyntaxRangesRejectMalformedAndSurrogateSplittingPayloads() throws {
        let source = "😀 const x = 42;"
        let good = configuration(source, runs: [[0, 3, 0], [3, 5, 1], [8, source.utf16.count - 8, 0]])
        let index = try XCTUnwrap(XgentCodeSyntaxIndex(good))
        XCTAssertEqual(index.intersections(NSRange(location: 4, length: 3)), [.init(range: NSRange(location: 4, length: 3), style: 1)])
        XCTAssertEqual(index.intersections(NSRange(location: NSNotFound, length: 1)), [])
        XCTAssertEqual(index.intersections(NSRange(location: 2, length: Int.max)), [])
        for runs in [[[1, 2, 0]], [[0, 1, 0]], [[0, 4, 0], [3, 2, 1]], [[0, Int.max, 0]], [[0, 2, 40]], [[0, 2]]] {
            XCTAssertNil(XgentCodeSyntaxIndex(configuration(source, runs: runs)))
        }
        let text = String(repeating: "x ", count: 5000)
        let large = try XCTUnwrap(XgentCodeSyntaxIndex(configuration(text, runs: (0..<5000).map { [$0 * 2, 1, 0] })))
        XCTAssertEqual(large.intersections(NSRange(location: 9998, length: 2)), [.init(range: NSRange(location: 9998, length: 1), style: 0)])
    }

    @MainActor func testMountedSyntaxUsesSharedColorsPreservesSourceUndoAndClearsStaleRanges() async throws {
        let source = "const value = 42;", config = configuration(source, runs: [[0, 5, 1], [5, 9, 0], [14, 2, 2], [16, 1, 0]])
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
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
        let original = NSAttributedString(attributedString: storage), undo = input.undoManager?.canUndo, count = actions.count
        let painter = XgentCodeFindHighlighting(); painter.attach(input); painter.update(nil, syntax: config, colorScheme: .light)
        validate(manager)
        let blue = SyntaxTestColor(Color(xgentHex: "#0000ff")), green = SyntaxTestColor(Color(xgentHex: "#098658"))
        XCTAssertTrue(blue.isEqual(attributes(manager, at: 0)[.foregroundColor]))
        XCTAssertTrue(green.isEqual(attributes(manager, at: 14)[.foregroundColor]))
        XCTAssertTrue(original.isEqual(to: storage)); XCTAssertEqual(undo, input.undoManager?.canUndo); XCTAssertEqual(count, actions.count)
        XCTAssertEqual((attributes(manager, at: 0)[.font] as? XgentCodeSyntaxNativeFont)?.pointSize, input.font?.pointSize)
        painter.update(nil, syntax: config, colorScheme: .dark); validate(manager)
        XCTAssertTrue(SyntaxTestColor(Color(xgentHex: "#569cd6")).isEqual(attributes(manager, at: 0)[.foregroundColor]))
        #if os(iOS)
        input.becomeFirstResponder(); input.selectedRange = .zero; input.insertText("//")
        #else
        window.makeFirstResponder(input); input.setSelectedRange(.zero); input.insertText("//", replacementRange: .zero)
        #endif
        try await Task.sleep(nanoseconds: 150_000_000); validate(manager)
        XCTAssertFalse(SyntaxTestColor(Color(xgentHex: "#569cd6")).isEqual(attributes(manager, at: 0)[.foregroundColor]), "Old source tokens must retire before native rendering")
        painter.detach(); validate(manager)
        XCTAssertNotNil(attributes(manager, at: 0)[.foregroundColor], "The upstream native renderer must survive syntax removal")
    }

    @MainActor func testSyntaxFontTraitsKeepTheNativeFamilyAndSize() {
        #if os(iOS)
        let base = UIFont.monospacedSystemFont(ofSize: 19, weight: .regular)
        #else
        let base = NSFont.monospacedSystemFont(ofSize: 19, weight: .regular)
        #endif
        let emphasized = XgentCodeSyntaxFont.styled(base, flags: 3)
        XCTAssertEqual(emphasized.pointSize, 19)
        XCTAssertEqual(emphasized.familyName, base.familyName)
        let regular = XgentCodeSyntaxFont.styled(emphasized, flags: 0)
        XCTAssertEqual(regular.pointSize, 19); XCTAssertEqual(regular.familyName, base.familyName)
    }

    private func configuration(_ source: String, runs: [[Int]]) -> XgentCodeSyntaxConfiguration {
        let styles: [XgentCodeSyntaxAppearance] = [
            .init(light: .init(color: "#000000", fontStyle: 0), dark: .init(color: "#d4d4d4", fontStyle: 0)),
            .init(light: .init(color: "#0000ff", fontStyle: 0), dark: .init(color: "#569cd6", fontStyle: 0)),
            .init(light: .init(color: "#098658", fontStyle: 0), dark: .init(color: "#b5cea8", fontStyle: 0)),
        ]
        return .init(source: source, languageId: "javascript", revision: 1, styles: styles, runs: runs)
    }
    @MainActor private func editor(in view: SyntaxTestView) -> XgentFindHighlightTextView? {
        if let input = view as? XgentFindHighlightTextView, input.isEditable { return input }
        return view.subviews.lazy.compactMap { editor(in: $0) }.first
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
        return result
    }
    private func fixture(_ content: String) throws -> XgentDocument {
        let payload: [String: Any] = ["version": 1, "surface": "syntax", "revision": 1, "mode": "root", "title": "Source",
            "nodes": [["id": "file", "kind": "BrowserLayout", "fill": true, "children": [["id": "code", "kind": "TextArea", "label": "Example.js",
                "language": "javascript", "value": content, "action": "edit", "fill": true]]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
