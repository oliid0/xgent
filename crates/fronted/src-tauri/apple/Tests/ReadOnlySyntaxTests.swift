import Foundation
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
private typealias SyntaxColor = UIColor
#else
import AppKit
private typealias SyntaxColor = NSColor
#endif
@testable import XgentNativeUI

final class ReadOnlySyntaxTests: XCTestCase {
    func testAttributedCodeKeepsExactSourceAndUsesSharedColorsWithoutFixingFontSize() throws {
        let source = "const emoji = '🧭';\n"
        let syntax = try XCTUnwrap(XgentReadOnlySyntax.decode(reply(source)))
        for scheme in [ColorScheme.light, .dark] {
            let display = XgentCodeBlockMetrics(source: source).displayText
            let attributed = XgentReadOnlySyntaxRenderer(syntax: syntax, scheme: scheme).attributedCode(display)
            XCTAssertEqual(attributed.string, display)
            let expected = SyntaxColor(Color(xgentHex: scheme == .dark ? "#b2a7c1" : "#645a72"))
            XCTAssertTrue(expected.isEqual(attributed.attribute(.foregroundColor, at: 0, effectiveRange: nil)))
            XCTAssertNil(attributed.attribute(.font, at: 0, effectiveRange: nil))
        }
        XCTAssertTrue(syntax.matches(source: source, language: "javascript", theme: "stone"))
        XCTAssertFalse(syntax.matches(source: source + "next", language: "javascript", theme: "stone"))
        XCTAssertFalse(syntax.matches(source: source, language: "javascript", theme: "matcha"))
        let canonical = try XCTUnwrap(XgentReadOnlySyntax.decode(reply("é", runs: [])))
        XCTAssertFalse(canonical.matches(source: "e\u{301}", language: "javascript", theme: "stone"), "Canonical Unicode equality cannot validate UTF16 token offsets")
    }

    func testReplyValidationRejectsSplitSurrogatesOverlapAndMissingStyles() {
        for runs in [[[0, 1, 0]], [[0, 2, 0], [1, 1, 1]], [[0, 2, 42]], [[0, Int.max, 0]]] {
            XCTAssertNil(XgentReadOnlySyntax.decode(reply("🧭x", runs: runs)))
        }
        XCTAssertNil(XgentReadOnlySyntax.decode(reply("value").replacingOccurrences(of: "#645a72", with: "bad-color")))
        let plain = XgentReadOnlySyntax.decode(reply("swift unsupported", runs: []))
        XCTAssertNotNil(plain, "Unsupported shared languages still have a valid plain-color result")
    }

    @MainActor func testHighlightReplyIsReadOnlyAndCannotCompleteAnotherSurface() async throws {
        let model = XgentPresentationModel(), document = try fixture()
        model.update(document)
        let emitted = expectation(description: "query emitted")
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0); emitted.fulfill() }
        let node = try XCTUnwrap(document.node(id: "markdown"))
        let pending = Task { await model.highlightCode(node, in: document, source: "const value = 42", language: "javascript") }
        await fulfillment(of: [emitted], timeout: 2)
        let action = try XCTUnwrap(actions.first)
        XCTAssertTrue(model.busy.isEmpty); XCTAssertTrue(model.edits.isEmpty); XCTAssertNil(model.error)
        model.complete(.init(surface: "other", requestId: action.requestId, ok: true, error: nil, acceptedValue: .string("wrong")))
        model.complete(.init(surface: document.surface, requestId: action.requestId, ok: true, error: nil, acceptedValue: .string("actual")))
        let result = await pending.value
        XCTAssertEqual(result, "actual")
        XCTAssertTrue(model.busy.isEmpty); XCTAssertTrue(model.edits.isEmpty); XCTAssertNil(model.error)
        model.invalidate()
    }

    @MainActor func testCancellationInvalidationAndSourceNodeRemovalRetireQueriesQuietly() async throws {
        for operation in ["cancel", "invalidate", "replace", "replace-kind", "remove", "failure"] {
            let model = XgentPresentationModel(), document = try fixture()
            model.update(document)
            let emitted = expectation(description: operation)
            var action: XgentAction?
            model.actionSink = { action = $0; emitted.fulfill() }
            let node = try XCTUnwrap(document.node(id: "markdown"))
            let pending = Task { await model.highlightCode(node, in: document, source: "42", language: "json") }
            await fulfillment(of: [emitted], timeout: 2)
            let emittedAction = try XCTUnwrap(action)
            switch operation {
            case "cancel": pending.cancel()
            case "invalidate": model.invalidate()
            case "replace": model.update(try fixture(revision: 2, action: "replacement"))
            case "replace-kind": model.update(try fixture(revision: 2, kind: "Button"))
            case "remove": model.update(try fixture(revision: 2, removed: true))
            default: model.complete(.init(surface: document.surface, requestId: emittedAction.requestId, ok: false, error: "Cannot highlight"))
            }
            let result = await pending.value
            XCTAssertNil(result)
            XCTAssertTrue(model.edits.isEmpty); XCTAssertTrue(model.busy.isEmpty); XCTAssertNil(model.error)
            model.complete(.init(surface: document.surface, requestId: emittedAction.requestId, ok: true, error: nil, acceptedValue: .string("late")))
            XCTAssertNil(model.error)
            model.invalidate()
        }
    }

    private func reply(_ source: String, runs: [[Int]] = [[0, 5, 1]]) -> String {
        let value: [String: Any] = ["source": source, "language": "javascript", "theme": "stone", "baseStyle": 0,
            "backgroundStyle": 0, "styles": [["light": "#5e5e5e", "dark": "#ababb0"], ["light": "#645a72", "dark": "#b2a7c1"]], "runs": runs]
        return String(data: try! JSONSerialization.data(withJSONObject: value), encoding: .utf8)!
    }

    private func fixture(revision: Int = 1, action: String = "highlight", removed: Bool = false, kind: String = "Markdown") throws -> XgentDocument {
        let value: [String: Any] = ["version": 1, "surface": "chat", "revision": revision, "mode": "root", "appearance": "system", "title": "Chat",
            "removed": removed, "nodes": [["id": "markdown", "kind": kind, "action": action, "text": "```javascript\n42\n```"]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: value))
        try document.validate()
        return document
    }
}
