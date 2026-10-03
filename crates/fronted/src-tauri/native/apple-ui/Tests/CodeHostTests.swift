import Foundation
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
private typealias CodeHostTestView = UIView
private typealias CodeHostTestEditor = UITextView
#else
import AppKit
private typealias CodeHostTestView = NSView
private typealias CodeHostTestEditor = NSTextView
#endif
@testable import XgentNativeUI

final class CodeHostTests: XCTestCase {
    @MainActor func testDetachedAndRetiredSourceBindingsCannotChangeAnotherMount() {
        let source = XgentCodeHostSource("Initial"), a = UUID(), b = UUID()
        var first: [String] = [], second: [String] = []
        source.activate(a, content: "Initial", editable: true) { first.append($0) }
        let old = source.binding(a); old.wrappedValue = "Draft"
        source.detach(a); old.wrappedValue = "Stale hidden input"
        XCTAssertEqual(source.content, "Draft")
        source.activate(b, content: "Draft", editable: true) { second.append($0) }
        old.wrappedValue = "Stale old mount"; source.binding(b).wrappedValue = "Later"
        source.detach(a)
        XCTAssertTrue(source.owns(b)); XCTAssertEqual(first, ["Draft"]); XCTAssertEqual(second, ["Later"])
        source.activate(b, content: "Later", editable: false) { second.append($0) }
        source.binding(b).wrappedValue = "Read-only input"
        XCTAssertEqual(source.content, "Later")
        source.retire(); source.binding(b).wrappedValue = "Closed input"
        XCTAssertFalse(source.owns(b)); XCTAssertEqual(source.content, "Later")
    }

    @MainActor func testSessionSnapshotsEvictClosedHostsRejectReplaysAndKeepWorkspacesIndependent() throws {
        let store = XgentCodeHostStore(), first = session("a:1"), second = session("b:2")
        let a = try XCTUnwrap(store.acquire(first, content: "A"))
        let b = try XCTUnwrap(store.acquire(second, content: "B"))
        XCTAssertTrue(try XCTUnwrap(store.acquire(first, content: "A")) === a)
        XCTAssertFalse(a.undo === b.undo)
        XCTAssertTrue(store.reconcile(.init(scope: "project", open: ["b:2"], revision: 2), surface: "chat"))
        XCTAssertNil(store.acquire(first, content: "Old closed A"))
        XCTAssertFalse(store.reconcile(.init(scope: "project", open: ["a:1", "b:2"], revision: 1), surface: "chat"))
        let other = XgentCodeSessionIdentity(scope: "other", key: "a:1", open: ["a:1"])
        let foreign = try XCTUnwrap(store.acquire(other, content: "Other workspace"))
        XCTAssertTrue(store.reconcile(.init(scope: "project", open: [], revision: 3), surface: "chat"))
        XCTAssertNil(store.acquire(second, content: "Closed all"))
        XCTAssertTrue(store.reconcile(.init(scope: "project", open: ["a:4"], revision: 4), surface: "chat"))
        let reopened = try XCTUnwrap(store.acquire(session("a:4", open: ["a:4"]), content: "A"))
        XCTAssertFalse(reopened === a); XCTAssertFalse(reopened.undo.canUndo)
        XCTAssertEqual(store.remove(surface: "chat"), ["project"])
        XCTAssertNil(store.acquire(session("a:4", open: ["a:4"]), content: "Removed surface"))
        XCTAssertFalse(store.reconcile(.init(scope: "project", open: ["a:4"], revision: 4), surface: "chat"))
        XCTAssertTrue(store.reconcile(.init(scope: "project", open: ["a:5"], revision: 5), surface: "returned-chat"))
        XCTAssertNotNil(store.acquire(session("a:5", open: ["a:5"]), content: "New session"))
        XCTAssertEqual(store.remove(surface: "chat"), [])
        XCTAssertTrue(try XCTUnwrap(store.acquire(other, content: "Other workspace")) === foreign)
        store.clear(); XCTAssertNil(store.acquire(other, content: "After invalidation"))
    }

    @MainActor func testNativeInputSnapshotRejectsDelayedValuesAndCommitsBeforeSourceActions() {
        let source = XgentCodeHostSource("Before"), lease = UUID()
        var native = "Committed", events: [String] = []
        source.activate(lease, content: "Before", editable: true) { events.append($0) }
        source.attachInput(read: { native }, commit: { true })
        source.binding(lease).wrappedValue = "Old queued edit"
        XCTAssertEqual(source.content, "Before")
        source.commitCurrent()
        XCTAssertEqual(source.content, "Committed"); XCTAssertEqual(events, ["Committed"])
        native = "Later input"
        source.binding(lease).wrappedValue = native
        source.binding(lease).wrappedValue = "Committed"
        XCTAssertEqual(source.content, "Later input"); XCTAssertEqual(events, ["Committed", "Later input"])
        source.detach(lease); native = "Hidden"; source.commitCurrent()
        XCTAssertEqual(source.content, "Later input")
    }

    @MainActor func testRetiredViewportsCannotRecreateClosedSessionRecords() {
        let store = XgentCodeSessionStore(), identity = session("a:1"), owner = UUID()
        store.prepare(identity, owner: owner)
        XCTAssertTrue(store.owns(identity, owner: owner))
        store.reconcile(scope: identity.scope, open: [])
        store.prepare(identity, owner: owner)
        XCTAssertFalse(store.owns(identity, owner: owner))
        let reopened = session("a:3", open: ["a:3"])
        store.reconcile(scope: identity.scope, open: [reopened.key])
        store.prepare(reopened, owner: owner)
        store.prepare(identity, owner: UUID())
        XCTAssertTrue(store.owns(reopened, owner: owner))
        XCTAssertFalse(store.owns(identity, owner: owner))
    }

    @MainActor func testRealTextViewsAndUndoStayWithTheirFilesAcrossHideSwitchAndFreshSurface() async throws {
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let first = try fixture(surface: "first", key: "a:1", content: "let count = 1")
        model.update(first)
        #if os(iOS)
        let host = UIHostingController(rootView: AnyView(render(first, model)))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 640, height: 400))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        let root = host.view!
        #else
        let host = NSHostingView(rootView: AnyView(render(first, model)))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        let root = host
        #endif
        try await settle()
        let a = try XCTUnwrap(editor(in: root))
        #if os(iOS)
        a.becomeFirstResponder(); a.selectedRange = NSRange(location: a.text.utf16.count, length: 0); a.insertText(" // A")
        #else
        window.makeFirstResponder(a); a.setSelectedRange(NSRange(location: a.string.utf16.count, length: 0)); a.insertText(" // A", replacementRange: a.selectedRange())
        #endif
        try await settle(); XCTAssertTrue(try XCTUnwrap(a.undoManager).canUndo)
        let second = try fixture(surface: "second", key: "b:2", content: "let count = 2")
        model.update(second); host.rootView = AnyView(render(second, model)); try await settle()
        let b = try XCTUnwrap(editor(in: root)); XCTAssertFalse(b === a); XCTAssertFalse(b.undoManager === a.undoManager)
        #if os(iOS)
        b.becomeFirstResponder(); b.selectedRange = NSRange(location: b.text.utf16.count, length: 0); b.insertText(" // B")
        #else
        window.makeFirstResponder(b); b.setSelectedRange(NSRange(location: b.string.utf16.count, length: 0)); b.insertText(" // B", replacementRange: b.selectedRange())
        #endif
        try await settle()
        let removal: [String: Any] = ["version": 1, "surface": "first", "revision": 2, "mode": "root", "title": "", "appearance": "system", "removed": true, "nodes": []]
        let removed = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: removal))
        model.update(removed)
        XCTAssertEqual(source(a), "let count = 1 // A", "Removed surfaces must not reset cached native storage")
        let returned = try fixture(surface: "returned", key: "a:1", content: "let count = 1 // A")
        model.update(returned); host.rootView = AnyView(render(returned, model)); try await settle()
        let resumed = try XCTUnwrap(editor(in: root))
        try attachNativeAccessibilityEvidence(model.codeHosts.nativeEvidence() + [[
            "original": String(describing: ObjectIdentifier(a)), "resumed": String(describing: ObjectIdentifier(resumed)),
            "originalInWindow": String(a.window != nil), "resumedInWindow": String(resumed.window != nil),
        ]], name: "code-host-returned-native-lifetime")
        XCTAssertTrue(resumed === a)
        #if os(iOS)
        resumed.becomeFirstResponder()
        #else
        window.makeFirstResponder(resumed)
        #endif
        resumed.undoManager?.undo(); try await settle()
        XCTAssertEqual(source(resumed), "let count = 1"); XCTAssertEqual(source(b), "let count = 2 // B")
        XCTAssertEqual(actions.last?.surface, "returned"); XCTAssertEqual(actions.last?.value, .string("let count = 1"))
        resumed.undoManager?.redo(); try await settle()
        XCTAssertEqual(source(resumed), "let count = 1 // A")
        XCTAssertEqual(actions.last?.surface, "returned")
        host.rootView = AnyView(EmptyView()); try await settle()
        host.rootView = AnyView(render(returned, model)); try await settle()
        XCTAssertTrue(editor(in: root) === a)
        XCTAssertTrue(try XCTUnwrap(a.undoManager).canUndo)

        let reloaded = try fixture(surface: "reloaded", key: "a:1", content: "let count = 99")
        model.update(reloaded); host.rootView = AnyView(render(reloaded, model)); try await settle()
        let reloadInput = try XCTUnwrap(editor(in: root))
        XCTAssertTrue(reloadInput === a, "Disk reload keeps the existing native editor")
        XCTAssertEqual(source(reloadInput), "let count = 99")
        XCTAssertFalse(try XCTUnwrap(reloadInput.undoManager).canUndo, "Undo cannot restore the pre-reload file")
        XCTAssertTrue(try XCTUnwrap(b.undoManager).canUndo, "Reload must not erase another file's undo history")
    }

    @MainActor private func settle() async throws { try await Task.sleep(nanoseconds: 350_000_000) }
    private func session(_ key: String, open: [String] = ["a:1", "b:2"]) -> XgentCodeSessionIdentity {
        .init(scope: "project", key: key, open: open)
    }
    @MainActor private func render(_ document: XgentDocument, _ model: XgentPresentationModel) -> some View {
        XgentTextArea(node: document.nodes[0], document: document, model: model).id(document.surface)
    }
    @MainActor private func editor(in view: CodeHostTestView) -> CodeHostTestEditor? {
        if let input = view as? CodeHostTestEditor, input.isEditable { return input }
        return view.subviews.lazy.compactMap { self.editor(in: $0) }.first
    }
    @MainActor private func source(_ editor: CodeHostTestEditor) -> String {
        #if os(iOS)
        return editor.text ?? ""
        #else
        return editor.string
        #endif
    }
    private func fixture(surface: String, key: String, content: String) throws -> XgentDocument {
        let metadata: [String: Any] = ["session": ["scope": "project", "key": key, "open": ["a:1", "b:2"]]]
        let value: [String: Any] = ["version": 1, "surface": surface, "revision": 1, "mode": "root", "title": key, "appearance": "system", "nodes": [
            ["id": "workspace-file-editor", "kind": "TextArea", "variant": "workspace-code-editor", "label": "Example.swift", "language": "swift", "value": content,
             "text": String(decoding: try JSONSerialization.data(withJSONObject: metadata), as: UTF8.self), "action": "edit", "fill": true]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: value))
        try document.validate(); return document
    }
}
