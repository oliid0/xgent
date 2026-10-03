import Foundation
import XCTest
@testable import XgentNativeUI

final class NumberCommitBatchTests: XCTestCase {
    @MainActor func testSaveWaitsForNumericCommitAndWrongSurfaceCannotReleaseIt() throws {
        let model = XgentPresentationModel(), document = try fixture()
        model.update(document)
        let number = document.nodes[0], save = document.nodes[1]
        let state = XgentNumberInputState(); state.draft.pending = "123"
        _ = model.numberDrafts.attach(surface: document.surface, node: number, state: state)
        var emitted: [XgentAction] = []
        model.actionSink = { emitted.append($0) }
        model.send(save, in: document)
        XCTAssertEqual(emitted.map(\.action), ["timeout"])
        XCTAssertTrue(model.isBusy(save, in: document)); XCTAssertTrue(model.hasNumberCommitBatch(in: document))
        XCTAssertNil(state.draft.pending)
        let commit = try XCTUnwrap(emitted.first)
        XCTAssertEqual(commit.value, .number(123))
        model.complete(.init(surface: "other", requestId: commit.requestId, ok: true))
        XCTAssertEqual(emitted.count, 1)
        model.update(try fixture(revision: 2, value: 123))
        model.complete(.init(surface: document.surface, requestId: commit.requestId, ok: true, acceptedValue: .number(123)))
        XCTAssertEqual(emitted.map(\.action), ["timeout", "save"])
        XCTAssertFalse(model.hasNumberCommitBatch(in: document))
        XCTAssertTrue(model.edits.isEmpty)
        model.invalidate()
    }

    @MainActor func testExistingBlurCommitAlsoPrecedesSaveAndFailuresOrRetirementNeverEmitSave() throws {
        for outcome in ["success", "failure", "invalidate", "replace", "remove"] {
            let model = XgentPresentationModel(), document = try fixture()
            model.update(document)
            var emitted: [XgentAction] = []
            model.actionSink = { emitted.append($0) }
            model.send(document.nodes[0], in: document, value: .number(123), editing: true)
            let commit = try XCTUnwrap(emitted.first)
            model.send(document.nodes[1], in: document)
            XCTAssertEqual(emitted.count, 1)
            switch outcome {
            case "invalidate": model.invalidate()
            case "replace": model.update(try fixture(revision: 2, action: "replacement"))
            case "remove": model.update(try fixture(revision: 2, removed: true))
            default: break
            }
            model.complete(.init(surface: document.surface, requestId: commit.requestId, ok: outcome != "failure", error: "failed", acceptedValue: .number(123)))
            XCTAssertEqual(emitted.contains { $0.action == "save" }, outcome == "success", outcome)
            XCTAssertFalse(model.hasNumberCommitBatch(in: document))
            if outcome != "success" { XCTAssertFalse(model.isBusy(document.nodes[1], in: document)) }
            model.invalidate()
        }
    }

    @MainActor func testSynchronousAcknowledgementsDoNotMissTheRegisteredWaitAndRepeatedSaveIsLocked() throws {
        let model = XgentPresentationModel(), document = try fixture()
        model.update(document)
        let state = XgentNumberInputState(); state.draft.pending = "123"
        _ = model.numberDrafts.attach(surface: document.surface, node: document.nodes[0], state: state)
        var emitted: [XgentAction] = []
        model.actionSink = { action in
            emitted.append(action)
            if action.action == "timeout" {
                model.complete(.init(surface: action.surface, requestId: action.requestId, ok: true, acceptedValue: action.value))
            }
        }
        model.send(document.nodes[1], in: document)
        model.send(document.nodes[1], in: document)
        XCTAssertEqual(emitted.map(\.action), ["timeout", "save"])
        model.invalidate()
    }

    @MainActor func testRetiredDraftLeaseCannotDetachTheNewOwnerAndInvalidDraftRevertsWithoutMutation() throws {
        let model = XgentPresentationModel(), document = try fixture()
        model.update(document)
        let old = XgentNumberInputState(), current = XgentNumberInputState()
        old.draft.pending = "500"; current.draft.pending = "-"
        let oldLease = model.numberDrafts.attach(surface: document.surface, node: document.nodes[0], state: old)
        _ = model.numberDrafts.attach(surface: document.surface, node: document.nodes[0], state: current)
        model.numberDrafts.detach(surface: document.surface, node: document.nodes[0].id, lease: oldLease)
        var emitted: [XgentAction] = []
        model.actionSink = { emitted.append($0) }
        model.send(document.nodes[1], in: document)
        XCTAssertEqual(emitted.map(\.action), ["save"])
        XCTAssertNil(current.draft.pending); XCTAssertEqual(old.draft.pending, "500")
        XCTAssertTrue(model.edits.isEmpty)
        model.invalidate()
    }

    private func fixture(revision: Int = 1, value: Double = 300, action: String = "save", removed: Bool = false) throws -> XgentDocument {
        let object: [String: Any] = ["version": 1, "surface": "numbers", "revision": revision,
            "mode": "sheet", "appearance": "light", "title": "Settings", "removed": removed,
            "nodes": [["id": "timeout", "kind": "NumberInput", "action": "timeout", "value": value,
                       "minimum": 5, "maximum": 600, "step": 1, "integerOnly": true],
                      ["id": "save", "kind": "Button", "action": action, "label": "Save"]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: object))
        try document.validate()
        return document
    }
}
