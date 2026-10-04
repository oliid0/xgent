import Foundation
import XCTest
@testable import XgentNativeUI

final class ComposerSelectionBridgeTests: XCTestCase {
    @MainActor func testCaretReportsKeepTheOptimisticTextAndRejectRetiredContexts() throws {
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let initial = try document(revision: 1, selectionAction: "selection:one")
        model.update(initial)
        defer { model.invalidate() }
        let input = try XCTUnwrap(initial.node(id: "draft"))
        model.send(input, in: initial, value: .string("你好😀 @doc suffix"), editing: true)
        let draftAction = try XCTUnwrap(actions.last)
        model.reportComposerSelection(NSRange(location: 10, length: 0), text: "你好😀 @doc suffix", node: input, in: initial)
        let report = try XCTUnwrap(actions.last)
        XCTAssertEqual(report.action, "selection:one")
        let data = try XCTUnwrap(report.value.text.data(using: .utf8))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(payload["location"] as? Int, 10)
        model.complete(.init(surface: initial.surface, requestId: report.requestId, ok: true, error: nil, acceptedValue: report.value))
        XCTAssertEqual(model.value(input, in: initial), draftAction.value)
        XCTAssertFalse(model.isBusy(input, in: initial))
        let count = actions.count
        model.reportComposerSelection(NSRange(location: 40, length: 0), text: draftAction.value.text, node: input, in: initial)
        model.reportComposerSelection(NSRange(location: 0, length: 0), text: "stale", node: input, in: initial)
        model.update(try document(revision: 2, selectionAction: "selection:two"))
        model.reportComposerSelection(NSRange(location: 0, length: 0), text: "", node: input, in: initial)
        XCTAssertEqual(actions.count, count)
    }

    private func document(revision: Int, selectionAction: String) throws -> XgentDocument {
        let result = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "composer", "revision": revision, "mode": "root", "title": "Chat", "appearance": "system",
            "nodes": [["id": "draft", "kind": "ComposerInput", "value": "", "action": "draft", "selectionAction": selectionAction]],
        ]))
        try result.validate()
        return result
    }
}
