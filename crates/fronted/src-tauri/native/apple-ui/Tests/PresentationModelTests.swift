import Foundation
import WebKit
import XCTest
@testable import XgentNativeUI

@MainActor
private final class ActionWebView: WKWebView {
    var actions: [[String: Any]] = []

    override func callAsyncJavaScript(
        _ functionBody: String, arguments: [String: Any], in frame: WKFrameInfo?,
        in contentWorld: WKContentWorld,
        completionHandler: (@MainActor @Sendable (Result<Any, any Error>) -> Void)? = nil
    ) {
        if let action = arguments["action"] as? [String: Any] { actions.append(action) }
        completionHandler?(.success(true))
    }
}

final class PresentationModelTests: XCTestCase {
    @MainActor
    func testNormalizedAcknowledgementBeforeDocumentDoesNotObscureLaterClear() throws {
        let model = XgentPresentationModel()
        let webview = ActionWebView()
        model.webview = webview
        let initial = try document(1, value: "")
        let input = try XCTUnwrap(initial.node(id: "input"))
        model.update(initial)
        model.send(input, in: initial, value: .string("12a34567"), editing: true)
        model.complete(try acknowledgement(webview, index: 0, value: "123456"))
        XCTAssertEqual(model.value(input, in: initial), .string("123456"))
        model.update(try document(2, value: "123456"))
        XCTAssertTrue(model.edits.isEmpty)
        model.update(try document(3, value: ""))
        XCTAssertEqual(model.value(input, in: initial), .string(""))
    }

    @MainActor
    func testNormalizedDocumentBeforeAcknowledgementReconcilesAndRestoresDraft() throws {
        let model = XgentPresentationModel()
        let webview = ActionWebView()
        model.webview = webview
        let initial = try document(1, value: "")
        let input = try XCTUnwrap(initial.node(id: "input"))
        model.update(initial)
        model.send(input, in: initial, value: .string("one\r\ntwo"), editing: true)
        model.update(try document(2, value: "one\ntwo"))
        XCTAssertFalse(model.edits.isEmpty)
        model.complete(try acknowledgement(webview, index: 0, value: "one\ntwo"))
        XCTAssertTrue(model.edits.isEmpty)
        model.update(try document(3, value: "Restored conversation"))
        XCTAssertEqual(model.value(input, in: initial), .string("Restored conversation"))
    }

    @MainActor
    func testOlderAcknowledgementCannotReplaceNewerTyping() throws {
        let model = XgentPresentationModel()
        let webview = ActionWebView()
        model.webview = webview
        let initial = try document(1, value: "")
        let input = try XCTUnwrap(initial.node(id: "input"))
        model.update(initial)
        model.send(input, in: initial, value: .string("1a"), editing: true)
        model.send(input, in: initial, value: .string("12b"), editing: true)
        model.update(try document(2, value: "1"))
        model.complete(try acknowledgement(webview, index: 0, value: "1"))
        XCTAssertEqual(model.value(input, in: initial), .string("12b"))
        model.complete(try acknowledgement(webview, index: 1, value: "12"))
        XCTAssertEqual(model.value(input, in: initial), .string("12"))
        model.update(try document(3, value: "12"))
        XCTAssertTrue(model.edits.isEmpty)
    }

    @MainActor
    func testRemovedSurfaceDropsEditsAndIgnoresDelayedAcknowledgement() throws {
        let model = XgentPresentationModel()
        let webview = ActionWebView()
        model.webview = webview
        let initial = try document(1, value: "")
        model.update(initial)
        model.send(try XCTUnwrap(initial.node(id: "input")), in: initial,
                   value: .string("12a"), editing: true)
        let removal = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "test", "revision": 2, "mode": "root",
            "title": "Test", "appearance": "system", "nodes": [], "removed": true,
        ]))
        model.update(removal)
        model.complete(try acknowledgement(webview, index: 0, value: "12"))
        XCTAssertTrue(model.edits.isEmpty)
        XCTAssertTrue(model.documents.isEmpty)
    }

    @MainActor
    func testFocusRequestsAreExplicitOnceOnlyAndWaitForEnabledInput() throws {
        let model = XgentPresentationModel()
        let initial = try document(1, value: "", focusRequest: 0)
        let input = try XCTUnwrap(initial.node(id: "input"))
        model.update(initial)
        XCTAssertFalse(model.consumeFocusRequest(input, in: initial))
        model.update(try document(2, value: "Queued draft", focusRequest: 1, disabled: true))
        XCTAssertFalse(model.consumeFocusRequest(input, in: initial))
        model.update(try document(3, value: "Queued draft", focusRequest: 1))
        XCTAssertTrue(model.consumeFocusRequest(input, in: initial))
        XCTAssertFalse(model.consumeFocusRequest(input, in: initial))
        // Ordinary updates and a recreated view do not reopen the keyboard.
        model.update(try document(4, value: "Edited", focusRequest: 1))
        XCTAssertFalse(model.consumeFocusRequest(input, in: initial))
        model.update(try document(5, value: "Another edit", focusRequest: 2))
        XCTAssertTrue(model.consumeFocusRequest(input, in: initial))
    }

    @MainActor
    func testFocusConsumptionIsScopedToSurfaceAndDropsOnRemoval() throws {
        let model = XgentPresentationModel()
        let first = try document(1, value: "", focusRequest: 1)
        let second = try document(1, value: "", focusRequest: 1, surface: "other")
        let input = try XCTUnwrap(first.node(id: "input"))
        model.update(first)
        model.update(second)
        XCTAssertTrue(model.consumeFocusRequest(input, in: first))
        XCTAssertTrue(model.consumeFocusRequest(input, in: second))
        let removal = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "test", "revision": 2, "mode": "root",
            "title": "Test", "appearance": "system", "nodes": [], "removed": true,
        ]))
        model.update(removal)
        XCTAssertFalse(model.consumeFocusRequest(input, in: first))
        model.update(try document(3, value: "", focusRequest: 1))
        XCTAssertTrue(model.consumeFocusRequest(input, in: first))
        model.invalidate()
        XCTAssertFalse(model.consumeFocusRequest(input, in: second))
    }

    func testFocusValidationRejectsUnsafeTokens() throws {
        for request in [-1, 9_007_199_254_740_992] {
            XCTAssertThrowsError(try document(1, value: "", focusRequest: request))
        }
    }

    private func document(_ revision: Int, value: String, focusRequest: Int? = nil,
                          disabled: Bool = false, surface: String = "test") throws -> XgentDocument {
        var input: [String: Any] = [
            "id": "input", "kind": focusRequest == nil ? "TextInput" : "ComposerInput",
            "value": value, "action": "input", "disabled": disabled,
        ]
        if let focusRequest { input["focusRequest"] = focusRequest }
        let result = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": surface, "revision": revision, "mode": "root",
            "title": "Test", "appearance": "system", "nodes": [
                ["id": "group", "kind": "VStack", "children": [
                    input,
                ]],
            ],
        ]))
        try result.validate()
        return result
    }

    @MainActor
    private func acknowledgement(_ webview: ActionWebView, index: Int, value: String) throws -> XgentActionResult {
        let request = try XCTUnwrap(webview.actions[index]["requestId"] as? String)
        return XgentActionResult(surface: "test", requestId: request, ok: true, error: nil,
                                 acceptedValue: .string(value))
    }
}
