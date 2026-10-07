import Foundation
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
private typealias FindTestView = UIView
private typealias FindTestEditor = UITextView
#else
import AppKit
private typealias FindTestView = NSView
private typealias FindTestEditor = NSTextView
#endif
@testable import XgentNativeUI

final class CodeFindReplacementTests: XCTestCase {
    @MainActor func testExactReplacementUsesTheMountedCodeViewUndoManagerAndDoesNotAutoComplete() async throws {
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let before = "let value = \"😀cat\"\r\nlet other = 2"
        model.update(try fixture(before))
        #if os(iOS)
        let host = UIHostingController(rootView: XgentRootLayout(model: model))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        let root = host.view!
        #else
        let host = NSHostingView(rootView: XgentRootLayout(model: model))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        let root = host
        #endif
        try await Task.sleep(nanoseconds: 500_000_000)
        let input = try XCTUnwrap(editor(in: root))
        #if os(iOS)
        XCTAssertTrue(input.becomeFirstResponder())
        #else
        XCTAssertTrue(window.makeFirstResponder(input))
        #endif
        let range = (before as NSString).range(of: "cat")
        let edit = XgentCodeFindEdit(location: range.location, length: range.length, text: "(\n", request: 1, before: before)
        let replacement = XgentCodeReplacement(), after = (before as NSString).replacingCharacters(in: range, with: edit.text)
        let priorActions = actions.count, priorUndo = input.undoManager?.canUndo
        XCTAssertTrue(replacement.apply(XgentCodeFindEdit(location: range.location, length: range.length, text: "cat", request: 0, before: before), to: input))
        XCTAssertEqual(actions.count, priorActions)
        XCTAssertEqual(input.undoManager?.canUndo, priorUndo, "An unchanged replacement must not add an undo operation")
        XCTAssertTrue(replacement.apply(edit, to: input))
        XCTAssertEqual(source(input), after)
        XCTAssertEqual(actions.last?.value, .string(after))
        XCTAssertTrue(try XCTUnwrap(input.undoManager).canUndo)
        input.undoManager?.undo()
        XCTAssertEqual(source(input), before)
        XCTAssertEqual(actions.last?.value, .string(before))
        input.undoManager?.redo()
        XCTAssertEqual(source(input), after)
        XCTAssertFalse(replacement.apply(edit, to: input))
        XCTAssertEqual(source(input), after)
    }

    @MainActor func testFindRequestConsumptionSurvivesViewReconstructionAndRetiresWithTheTab() {
        let store = XgentCodeSessionStore(), owner = UUID(), returned = UUID()
        let session = XgentCodeSessionIdentity(scope: "editor", key: "a:1", open: ["a:1"])
        store.prepare(session, owner: owner)
        XCTAssertTrue(store.consumeFind(7, editing: true, session: session, owner: owner))
        XCTAssertTrue(store.consumeFind(7, editing: false, session: session, owner: owner))
        store.release(session, owner: owner); store.prepare(session, owner: returned)
        XCTAssertFalse(store.consumeFind(7, editing: true, session: session, owner: returned))
        XCTAssertFalse(store.consumeFind(8, editing: true, session: session, owner: owner))
        XCTAssertTrue(store.consumeFind(8, editing: true, session: session, owner: returned))
        let reopened = XgentCodeSessionIdentity(scope: "editor", key: "a:2", open: ["a:2"])
        store.prepare(reopened, owner: returned)
        XCTAssertTrue(store.consumeFind(1, editing: true, session: reopened, owner: returned))
    }

    @MainActor func testMountedFindRequestsRejectChangedSourceAndDoNotReplayAfterUndo() async throws {
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let before = "let value = cat", after = "let value = dog"
        let first = try findFixture(before, revision: 1, edit: false)
        model.update(first)
        #if os(iOS)
        let host = UIHostingController(rootView: XgentRootLayout(model: model))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 844))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        let root = host.view!
        #else
        let host = NSHostingView(rootView: XgentRootLayout(model: model))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 520), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        let root = host
        #endif
        // The retained code host publishes its configuration asynchronously.
        // Use the same mounted-input readiness condition as CodeHostTests;
        // a fixed delay can expire before a busy simulator attaches the view.
        let deadline = ContinuousClock.now + .seconds(2)
        repeat {
            #if os(iOS)
            root.layoutIfNeeded()
            #else
            root.layoutSubtreeIfNeeded()
            #endif
            if editor(in: root)?.window != nil { break }
            try await Task.sleep(for: .milliseconds(50))
        } while ContinuousClock.now < deadline
        let input = try XCTUnwrap(editor(in: root).flatMap { $0.window != nil ? $0 : nil },
                                 "The editable find input must mount within two seconds: \(model.codeHosts.nativeEvidence())")
        model.update(try findFixture(before, revision: 2, edit: true))
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(source(input), after)
        let ack = try XCTUnwrap(actions.last { $0.action == "find" })
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(ack.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(payload["applied"] as? Bool, true)
        let commands = XgentCodeEditingCommands()
        commands.attach(input)
        let undo = try XCTUnwrap(input.undoManager)
        XCTAssertTrue(commands.canUndo, "Replacement must keep undo history while the find field owns focus: \(model.codeHosts.nativeEvidence())")
        commands.undo()
        #if os(iOS)
        XCTAssertTrue(input.isFirstResponder)
        #else
        XCTAssertTrue(window.firstResponder === input)
        #endif
        XCTAssertEqual(source(input), before, "Undo must restore TextKit before another hosting update")
        XCTAssertTrue(undo.canRedo, "Undo must register the real inverse for redo")
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(source(input), before)
        model.update(try findFixture(before, revision: 3, edit: true))
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(source(input), before, "Re-publishing a consumed edit must not redo an undone replacement")
        // A later edit request with a stale expected source must be consumed and
        // rejected, even when that source becomes equal again in the future.
        model.update(try findFixture(before, revision: 4, edit: true, request: 2, expected: "let value = fox"))
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(source(input), before)
        let rejected = try XCTUnwrap(actions.last { $0.action == "find" })
        let rejectedPayload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(rejected.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(rejectedPayload["applied"] as? Bool, false)
    }

    @MainActor private func editor(in view: FindTestView) -> FindTestEditor? {
        if let input = view as? FindTestEditor, input.isEditable {
            #if os(macOS)
            if !input.isFieldEditor { return input }
            #else
            return input
            #endif
        }
        return view.subviews.lazy.compactMap { self.editor(in: $0) }.first
    }
    @MainActor private func source(_ view: FindTestEditor) -> String {
        #if os(iOS)
        return view.text ?? ""
        #else
        return view.string
        #endif
    }
    private func fixture(_ content: String) throws -> XgentDocument {
        let value: [String: Any] = ["version": 1, "surface": "find-edit", "revision": 1, "mode": "root", "title": "Find", "appearance": "system",
            "formFactor": "desktop", "nodes": [["id": "file", "kind": "BrowserLayout", "fill": true, "children": [
                ["id": "code", "kind": "TextArea", "language": "swift", "label": "Example.swift", "value": content, "action": "edit", "fill": true]]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: value))
        try document.validate(); return document
    }

    private func findFixture(_ content: String, revision: Int, edit: Bool, request: Int = 1, expected: String = "let value = cat") throws -> XgentDocument {
        let labels: [String: String] = ["query": "Find", "replacement": "Replace", "matchCase": "Match case", "wholeWord": "Whole word",
            "regex": "Regular expression", "selection": "In selection", "preserveCase": "Preserve case", "next": "Next", "previous": "Previous",
            "replace": "Replace", "replaceAll": "Replace all", "close": "Close", "invalid": "Invalid regex", "rejected": "Text changed", "noSelection": "Select text first"]
        var find: [String: Any] = ["identity": "file:1", "open": true, "replacing": true, "query": "cat", "replacement": "dog",
            "options": ["matchCase": false, "wholeWord": false, "regex": false, "selection": false, "preserveCase": false],
            "count": 1, "current": 1, "revision": request, "invalid": false, "limited": false, "rejected": false, "hasSelection": false,
            "labels": labels]
        if edit { find["edit"] = ["location": 12, "length": 3, "text": "dog", "before": expected, "request": request] }
        let metadata = try JSONSerialization.data(withJSONObject: ["find": find, "session": ["scope": "find-test", "key": "file:1", "open": ["file:1"]]])
        let value: [String: Any] = ["version": 1, "surface": "find-edit", "revision": revision, "mode": "root", "title": "Find", "appearance": "system",
            "formFactor": "mobile", "nodes": [["id": "file", "kind": "VStack", "variant": "workspace-file-layout", "fill": true, "children": [
                ["id": "workspace-file-find-action", "kind": "Button", "variant": "workspace-code-find-action", "action": "find"],
                ["id": "workspace-file-editor", "kind": "TextArea", "variant": "workspace-code-editor", "language": "swift", "label": "Example.swift",
                 "value": content, "text": String(decoding: metadata, as: UTF8.self), "action": "edit", "fill": true]]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: value))
        try document.validate(); return document
    }
}
