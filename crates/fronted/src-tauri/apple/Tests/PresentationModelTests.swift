import Foundation
import XCTest
@testable import XgentNativeUI

@MainActor
private final class ActionRecorder {
    var actions: [XgentAction] = []
    func record(_ action: XgentAction) { actions.append(action) }
}

final class PresentationModelTests: XCTestCase {
    @MainActor
    func testMetadataOnlyReferenceEditsWaitForTheirCanonicalReferenceAcknowledgement() throws {
        let reference = XgentComposerReference(id: "skill", location: 0, length: 7, label: "/review", icon: "sparkles")
        func fixture(_ revision: Int, references: [XgentComposerReference]) throws -> XgentDocument {
            let encoded = String(decoding: try JSONEncoder().encode(references), as: UTF8.self)
            let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
                "version": 1, "surface": "reference-test", "revision": revision, "mode": "root", "title": "Chat", "appearance": "system",
                "nodes": [["id": "draft", "kind": "ComposerInput", "action": "plain", "editAction": "references", "value": "/review",
                    "children": [["id": "draft-inline-references", "kind": "Text", "text": encoded]]]],
            ]))
            try document.validate(); return document
        }
        let initial = try fixture(1, references: [reference]), node = initial.nodes[0]
        let model = XgentPresentationModel(), recorder = ActionRecorder()
        model.actionSink = recorder.record; model.update(initial)
        // Replacing the displayed card with literal /review does not change text.
        model.sendComposerEdit(text: "/review", references: [], node: node, in: initial)
        let request = try XCTUnwrap(recorder.actions.last)
        model.complete(XgentActionResult(surface: initial.surface, requestId: request.requestId,
            ok: true, error: nil, acceptedValue: .string("/review")))
        XCTAssertEqual(model.composerReferences(node, in: initial), [])
        XCTAssertFalse(model.edits.isEmpty, "Equal text alone must not acknowledge different reference metadata")
        let stale = try fixture(2, references: [reference]); model.update(stale)
        XCTAssertEqual(model.composerReferences(stale.nodes[0], in: stale), [])
        let canonical = try fixture(3, references: []); model.update(canonical)
        XCTAssertNil(model.composerReferences(canonical.nodes[0], in: canonical))
        XCTAssertTrue(model.edits.isEmpty)
    }

    @MainActor
    func testComposerReferencePayloadKeepsPlainOptimisticTextAndRetiresItsOldOwner() throws {
        func fixture(_ revision: Int, action: String) throws -> XgentDocument {
            let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
                "version": 1, "surface": "reference-test", "revision": revision, "mode": "root", "title": "Chat", "appearance": "system",
                "nodes": [["id": "draft", "kind": "ComposerInput", "action": "plain", "editAction": action, "value": "Shared"]],
            ]))
            try document.validate(); return document
        }
        let model = XgentPresentationModel(), recorder = ActionRecorder()
        model.actionSink = recorder.record
        let initial = try fixture(1, action: "references-a"), node = initial.nodes[0]
        model.update(initial)
        let reference = XgentComposerReference(id: "skill", location: 0, length: 7, label: "/review", icon: "sparkles")
        model.sendComposerEdit(text: "/review", references: [reference], node: node, in: initial)
        XCTAssertEqual(recorder.actions.last?.action, "references-a")
        XCTAssertEqual(model.value(node, in: initial).text, "/review")
        let payload = try XCTUnwrap(recorder.actions.last)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(payload.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(object["text"] as? String, "/review")
        XCTAssertEqual((object["references"] as? [[String: Any]])?.first?["id"] as? String, "skill")
        let current = try fixture(2, action: "references-b"); model.update(current)
        XCTAssertTrue(model.edits.isEmpty)
        model.complete(XgentActionResult(surface: initial.surface, requestId: payload.requestId,
            ok: true, error: nil, acceptedValue: .string("/review")))
        XCTAssertEqual(model.value(current.nodes[0], in: current).text, "Shared")
        model.sendComposerEdit(text: "Late edit", references: [], node: node, in: initial)
        XCTAssertEqual(recorder.actions.count, 1)
    }

    @MainActor
    func testReusedProviderFieldDropsItsDraftAndRejectsThePreviousAcknowledgement() throws {
        let model = XgentPresentationModel(), recorder = ActionRecorder()
        model.actionSink = recorder.record
        let first = try document(1, value: "First credential", action: "provider-a:key")
        model.update(first)
        model.send(try XCTUnwrap(first.node(id: "input")), in: first,
                   value: .string("First draft"), editing: true)
        let second = try document(2, value: "Second credential", action: "provider-b:key")
        model.update(second)
        let current = try XCTUnwrap(second.node(id: "input"))
        XCTAssertTrue(model.edits.isEmpty)
        model.complete(try acknowledgement(recorder, index: 0, value: "First normalized credential"))
        XCTAssertEqual(model.value(current, in: second), .string("Second credential"))
        model.send(try XCTUnwrap(first.node(id: "input")), in: first,
                   value: .string("Late first field"), editing: true)
        XCTAssertEqual(recorder.actions.count, 1)
        model.send(current, in: second, value: .string("Second draft"), editing: true)
        XCTAssertEqual(recorder.actions.last?.action, "provider-b:key")
        XCTAssertEqual(model.value(current, in: second), .string("Second draft"))
    }

    @MainActor
    func testStaleControlsCannotEmitEditsAfterTheyAreDisabledOrReplaced() throws {
        for current in [try document(2, value: "Current", disabled: true),
                        try document(2, value: "Current", focusRequest: 0),
                        try document(2, value: "Current", action: "replacement")] {
            let model = XgentPresentationModel()
            let webview = ActionRecorder()
            model.actionSink = webview.record
            let initial = try document(1, value: "Initial")
            model.update(initial)
            model.update(current)
            model.send(try XCTUnwrap(initial.node(id: "input")), in: initial, value: .string("stale"), editing: true)
            XCTAssertTrue(webview.actions.isEmpty)
            XCTAssertTrue(model.edits.isEmpty)
        }
    }

    @MainActor
    func testNormalizedAcknowledgementBeforeDocumentDoesNotObscureLaterClear() throws {
        let model = XgentPresentationModel()
        let webview = ActionRecorder()
        model.actionSink = webview.record
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
        let webview = ActionRecorder()
        model.actionSink = webview.record
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
        let webview = ActionRecorder()
        model.actionSink = webview.record
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
        let webview = ActionRecorder()
        model.actionSink = webview.record
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

    @MainActor
    func testAttachmentOwnerSurvivesOrdinaryDocumentUpdatesAndEmitsTheCapturedAction() throws {
        let model = XgentPresentationModel()
        let webview = ActionRecorder()
        model.actionSink = webview.record
        let initial = try attachmentDocument(1, action: "attach:conversation:0")
        model.update(initial)
        let owner = XgentAttachmentOwner(node: try XCTUnwrap(initial.node(id: "attach")), document: initial, option: "files")
        model.update(try attachmentDocument(2, action: "attach:conversation:0"))
        XCTAssertTrue(owner.isCurrent(in: model))
        let files = [["fileName": "note.txt", "mimeType": "text/plain", "contentBase64": "aGk="]]
        try owner.send(files, in: model)
        XCTAssertEqual(webview.actions.count, 1)
        XCTAssertEqual(webview.actions[0].action, "attach:conversation:0")
        guard case .string(let value) = webview.actions[0].value else {
            XCTFail("Expected serialized attachment payload")
            return
        }
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [[String: String]], files)
    }

    @MainActor
    func testAttachmentOwnerRejectsChangedAndReturnedTargets() throws {
        let model = XgentPresentationModel()
        let webview = ActionRecorder()
        model.actionSink = webview.record
        let initial = try attachmentDocument(1, action: "attach:conversation:0")
        model.update(initial)
        let owner = XgentAttachmentOwner(node: try XCTUnwrap(initial.node(id: "attach")), document: initial, option: "files")
        for (index, action) in ["attach:other:1", "attach:conversation:2"].enumerated() {
            model.update(try attachmentDocument(index + 2, action: action))
            XCTAssertFalse(owner.isCurrent(in: model))
            XCTAssertThrowsError(try owner.send([["fileName": "old.txt"]], in: model))
        }
        XCTAssertTrue(webview.actions.isEmpty)
    }

    @MainActor
    func testAttachmentOwnerRejectsDisabledChoicesRemovedPickersAndInvalidatedModels() throws {
        for (disabled, optionDisabled, kind) in [(true, false, "FilePicker"), (false, true, "FilePicker"), (false, false, "TextInput")] {
            let model = XgentPresentationModel()
            let initial = try attachmentDocument(1, action: "attach:conversation:0")
            model.update(initial)
            let owner = XgentAttachmentOwner(node: try XCTUnwrap(initial.node(id: "attach")), document: initial, option: "files")
            model.update(try attachmentDocument(2, action: "attach:conversation:0", disabled: disabled,
                                               optionDisabled: optionDisabled, kind: kind))
            XCTAssertFalse(owner.isCurrent(in: model))
            XCTAssertThrowsError(try owner.send([["fileName": "old.txt"]], in: model))
            model.invalidate()
            XCTAssertFalse(owner.isCurrent(in: model))
        }
    }

    private func attachmentDocument(_ revision: Int, action: String, disabled: Bool = false,
                                    optionDisabled: Bool = false, kind: String = "FilePicker") throws -> XgentDocument {
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "test", "revision": revision, "mode": "root",
            "title": "Attachments", "appearance": "system", "nodes": [
                ["id": "attach", "kind": kind, "action": action, "disabled": disabled,
                 "options": [["value": "files", "label": "Files", "disabled": optionDisabled]]],
            ],
        ]))
        try document.validate()
        return document
    }

    private func document(_ revision: Int, value: String, focusRequest: Int? = nil,
                          disabled: Bool = false, surface: String = "test", action: String = "input") throws -> XgentDocument {
        var input: [String: Any] = [
            "id": "input", "kind": focusRequest == nil ? "TextInput" : "ComposerInput",
            "value": value, "action": action, "disabled": disabled,
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
    private func acknowledgement(_ webview: ActionRecorder, index: Int, value: String) throws -> XgentActionResult {
        let request = webview.actions[index].requestId
        return XgentActionResult(surface: "test", requestId: request, ok: true, error: nil,
                                 acceptedValue: .string(value))
    }
}
