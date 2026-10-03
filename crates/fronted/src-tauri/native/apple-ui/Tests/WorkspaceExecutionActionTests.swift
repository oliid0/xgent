import Foundation
import XCTest
@testable import XgentNativeUI

final class WorkspaceExecutionActionTests: XCTestCase {
    @MainActor func testOldRunSheetAndToolbarControlsCannotOperateANewerRunWithTheSameNodeIDs() throws {
        let model = XgentPresentationModel(), first = try fixture(run: "first", revision: 1)
        model.update(first)
        let oldStop = try XCTUnwrap(first.node(id: "workspace-file-stop"))
        let oldResult = try XCTUnwrap(first.node(id: "workspace-file-run-result-action"))
        let oldDismiss = try XCTUnwrap(first.node(id: "workspace-file-run-dismiss"))
        let second = try fixture(run: "second", revision: 2)
        model.update(second)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        for node in [oldStop, oldResult, oldDismiss] { model.send(node, in: first) }
        XCTAssertTrue(actions.isEmpty)
        model.send(try XCTUnwrap(second.node(id: "workspace-file-stop")), in: second)
        XCTAssertEqual(actions.last?.action, "stop:second")
        model.invalidate()
    }

    private func fixture(run: String, revision: Int) throws -> XgentDocument {
        let payload: [String: Any] = ["version": 1, "surface": "execution", "revision": revision, "mode": "root", "title": "Output", "nodes": [
            ["id": "workspace-file-stop", "kind": "Button", "label": "Stop", "action": "stop:\(run)"],
            ["id": "workspace-file-run-output", "kind": "VStack", "variant": "workspace-editor-run-output", "value": run, "children": [
                ["id": "workspace-file-run-result-action", "kind": "Button", "label": "Stop", "action": "result:\(run)"],
                ["id": "workspace-file-run-dismiss", "kind": "Button", "label": "Close output", "action": "dismiss:\(run)"]]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
