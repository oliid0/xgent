import Foundation
import XCTest
@testable import XgentNativeUI

final class WorkspaceSourceDraftTests: XCTestCase {
    @MainActor func testSourceSaveIncludesImmediateNativeInputAndRejectsRetiredDocuments() throws {
        let payload: [String: Any] = ["version": 1, "surface": "source", "revision": 1, "mode": "root", "title": "Source", "dismissAction": "close", "nodes": [
            ["id": "workspace-file-editor", "kind": "TextArea", "language": "python", "value": "Original", "action": "edit"],
            ["id": "workspace-file-save", "kind": "Button", "variant": "workspace-source-action", "current": 0, "action": "save"],
            ["id": "close", "kind": "Button", "variant": "workspace-source-action", "current": 0, "action": "close"]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let save = try XCTUnwrap(document.node(id: "workspace-file-save"))
        XCTAssertFalse(try XCTUnwrap(XgentWorkspaceSourceDraft.current(for: save, in: document, model: model)).dirty)
        model.send(try XCTUnwrap(document.node(id: "workspace-file-editor")), in: document,
                   value: .string("print('中文 😀')\n"), editing: true)
        let draft = try XCTUnwrap(XgentWorkspaceSourceDraft.current(for: save, in: document, model: model))
        XCTAssertTrue(draft.dirty)
        let encoded = try XCTUnwrap(draft.encoded)
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String: String])
        XCTAssertEqual(decoded, ["kind": "source", "content": "print('中文 😀')\n"])
        model.send(save, in: document, value: .string(encoded))
        XCTAssertEqual(actions.last?.value, .string(encoded))
        model.dismiss(document)
        XCTAssertEqual(actions.last?.action, "close")
        XCTAssertEqual(actions.last?.value, .string(encoded))
        model.invalidate()
        XCTAssertNil(XgentWorkspaceSourceDraft.current(for: save, in: document, model: model))
    }
}
