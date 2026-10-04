import Foundation
import XCTest
@testable import XgentNativeUI

final class TextInputCommitTests: XCTestCase {
    @MainActor func testCommitIncludesImmediateTypingAndNormalizedAcknowledgementsCannotOverwriteNewerTyping() throws {
        let model = XgentPresentationModel(), document = try fixture()
        model.update(document)
        var events: [XgentAction] = []
        model.actionSink = { events.append($0) }
        let input = try XCTUnwrap(document.node(id: "host"))
        model.send(input, in: document, value: .string(" localhost "), editing: true)
        model.send(input, in: document, value: model.value(input, in: document), editing: true, committing: true)
        XCTAssertEqual(events.map(\.action), ["edit", "commit"])
        XCTAssertEqual(events.last?.value, .string(" localhost "))
        let commit = try XCTUnwrap(events.last)
        model.send(input, in: document, value: .string("next-host"), editing: true)
        model.complete(try reply(commit, normalized: "localhost"))
        XCTAssertEqual(model.value(input, in: document), .string("next-host"))
        model.send(input, in: document, value: .string("next-host"), editing: true, committing: true)
        model.complete(try reply(try XCTUnwrap(events.last), normalized: "next-host"))
        model.update(try fixture(revision: 2, value: "next-host"))
        XCTAssertTrue(model.edits.isEmpty)
        model.invalidate()
    }

    @MainActor func testRetiredCommitOrDisabledFieldCannotCommitIntoAnotherSettingsPage() throws {
        for replacement in [try fixture(revision: 2, commit: "new-commit"),
                            try fixture(revision: 2, disabled: true)] {
            let model = XgentPresentationModel(), document = try fixture()
            model.update(document)
            var events: [XgentAction] = []
            model.actionSink = { events.append($0) }
            let input = try XCTUnwrap(document.node(id: "host"))
            model.send(input, in: document, value: .string("old-host"), editing: true)
            model.update(replacement)
            model.send(input, in: document, value: .string("old-host"), editing: true, committing: true)
            XCTAssertEqual(events.count, 1)
            model.invalidate()
        }
    }

    func testCommitContractRejectsUnsupportedControlsAndAliasedActions() throws {
        XCTAssertThrowsError(try fixture(commit: "edit"))
        XCTAssertThrowsError(try fixture(kind: "TextArea"))
        XCTAssertThrowsError(try fixture(commit: ""))
    }

    private func fixture(revision: Int = 1, value: String = "127.0.0.1", commit: String = "commit",
                         kind: String = "TextInput", disabled: Bool = false) throws -> XgentDocument {
        let data: [String: Any] = ["version": 1, "surface": "settings", "revision": revision,
            "mode": "root", "title": "Proxy", "appearance": "light", "nodes": [
                ["id": "host", "kind": kind, "value": value, "action": "edit", "commitAction": commit, "disabled": disabled]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: data))
        try document.validate()
        return document
    }

    private func reply(_ action: XgentAction, normalized: String) throws -> XgentActionResult {
        try JSONDecoder().decode(XgentActionResult.self, from: JSONSerialization.data(withJSONObject: [
            "surface": action.surface, "requestId": action.requestId, "ok": true, "acceptedValue": normalized]))
    }
}
