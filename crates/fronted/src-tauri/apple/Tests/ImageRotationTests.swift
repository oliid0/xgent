import Foundation
import XCTest
@testable import XgentNativeUI

final class ImageRotationTests: XCTestCase {
    func testQuarterTurnsAndRelativeBaseline() {
        XCTAssertEqual(XgentImageRotationDraft.normalized(-90), 270)
        for value in [-90.0, 45, 360, .infinity, .nan] { XCTAssertFalse(XgentImageRotationDraft.valid(value)) }
        for value in [0.0, 90, 180, 270] { XCTAssertTrue(XgentImageRotationDraft.valid(value)) }
    }

    @MainActor func testSaveReadsLatestNativeAngleBeforeSharedDocumentUpdate() throws {
        let payload: [String: Any] = ["version": 1, "surface": "image", "revision": 1, "mode": "root", "title": "Image", "appearance": "system", "nodes": [
            ["id": "workspace-file-media", "kind": "MediaPreview", "variant": "workspace-image-preview", "current": 90, "children": [
                ["id": "workspace-file-image-rotation", "kind": "NumberInput", "value": 90, "action": "rotate", "minimum": 0, "maximum": 270, "step": 90],
                ["id": "workspace-file-image-save", "kind": "Button", "variant": "workspace-image-save", "action": "save"]]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []
        model.actionSink = { action in
            actions.append(action)
            model.complete(.init(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
        }
        let rotate = try XCTUnwrap(document.node(id: "workspace-file-image-rotation"))
        model.send(rotate, in: document, value: .number(180), editing: true)
        model.send(rotate, in: document, value: .number(270), editing: true)
        XCTAssertEqual(XgentImageRotationDraft.angle(in: document, model: model), 270)
        XCTAssertEqual(XgentImageRotationDraft.relative(in: document, model: model), 180)
        model.send(try XCTUnwrap(document.node(id: "workspace-file-image-save")), in: document,
                   value: .number(try XCTUnwrap(XgentImageRotationDraft.angle(in: document, model: model))))
        XCTAssertEqual(actions.last?.value, .number(270))
        model.invalidate()
        model.send(rotate, in: document, value: .number(0), editing: true)
        XCTAssertEqual(actions.count, 3)
    }
}
