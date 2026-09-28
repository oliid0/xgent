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

    private func document(_ revision: Int, value: String) throws -> XgentDocument {
        let result = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "test", "revision": revision, "mode": "root",
            "title": "Test", "appearance": "system", "nodes": [
                ["id": "group", "kind": "VStack", "children": [
                    ["id": "input", "kind": "TextInput", "value": value, "action": "input"],
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
