import CodeEditorView
import Foundation
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class CodeEditorSessionTests: XCTestCase {
    @MainActor func testSessionPositionsAreIsolatedPrunedAndProtectedFromRetiredViews() {
        let store = XgentCodeSessionStore()
        let a = XgentCodeSessionIdentity(scope: "workspace", key: "a:1", open: ["a:1", "b:2"])
        let b = XgentCodeSessionIdentity(scope: "workspace", key: "b:2", open: a.open)
        let first = UUID(), second = UUID(), returned = UUID()
        store.prepare(a, owner: first)
        store.save(CodeEditor.Position(selections: [NSRange(location: 3, length: 1)], verticalScrollPosition: 280), session: a, owner: first, text: "A😀B", horizontal: 40)
        store.markRevealed("request:1", session: a, owner: first)
        store.release(a, owner: first)
        store.prepare(b, owner: second)
        XCTAssertEqual(store.position(b, text: "Second").selections, [.zero])
        store.prepare(a, owner: returned)
        store.save(CodeEditor.Position(), session: a, owner: first, text: "A😀B")
        XCTAssertEqual(store.position(a, text: "A😀B").selections, [NSRange(location: 3, length: 1)])
        XCTAssertEqual(store.position(a, text: "A😀B").verticalScrollPosition, 280)
        XCTAssertEqual(store.horizontal(a), 40)
        XCTAssertTrue(store.revealed("request:1", session: a))
        let closed = XgentCodeSessionIdentity(scope: "workspace", key: "b:2", open: ["b:2"])
        store.prepare(closed, owner: second)
        XCTAssertFalse(store.revealed("request:1", session: a))
        let reopened = XgentCodeSessionIdentity(scope: "workspace", key: "a:3", open: ["a:3", "b:2"])
        store.prepare(reopened, owner: UUID())
        XCTAssertEqual(store.position(reopened, text: "A😀B").verticalScrollPosition, 0)
        let other = XgentCodeSessionIdentity(scope: "another-window", key: a.key, open: [a.key])
        store.prepare(other, owner: UUID())
        XCTAssertEqual(store.position(other, text: "A😀B").selections, [.zero])
        store.clear(); store.prepare(a, owner: returned)
        XCTAssertFalse(store.owns(a, owner: returned))
    }

    func testSavedSelectionsClampShortenedTextAndUTF16SurrogatesWithoutOverflow() {
        let position = CodeEditor.Position(selections: [NSRange(location: 2, length: 0), NSRange(location: 2, length: 1), NSRange(location: 4, length: Int.max), NSRange(location: NSNotFound, length: 0)], verticalScrollPosition: .infinity)
        let clamped = XgentCodeSessionPosition.clamp(position, in: "A😀B")
        XCTAssertEqual(clamped.selections, [NSRange(location: 1, length: 0), NSRange(location: 1, length: 2), NSRange(location: 4, length: 0), .zero])
        XCTAssertEqual(clamped.verticalScrollPosition, 0)
        XCTAssertEqual(XgentCodeSessionPosition.clamp(CodeEditor.Position(selections: [NSRange(location: 200, length: 10)], verticalScrollPosition: 100), in: "").selections, [.zero])
    }

    @MainActor func testActualCodeViewsRestoreCaretAndScrollAfterReplacementWithoutReplayingAnOldReference() async throws {
        let model = XgentPresentationModel()
        let content = (1...200).map { "let line\($0) = \($0)" }.joined(separator: "\n")
        let first = try fixture(surface: "first", key: "a:1", content: content, request: "reference:1", line: 150)
        model.update(first)
        #if os(iOS)
        let host = UIHostingController(rootView: AnyView(render(first, model)))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 640, height: 360))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; model.invalidate() }
        #else
        let host = NSHostingView(rootView: AnyView(render(first, model)))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 360), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { window.close(); model.invalidate() }
        #endif
        try await Task.sleep(nanoseconds: 600_000_000)
        let original = try XCTUnwrap(editor(in: host))
        #if os(iOS)
        XCTAssertEqual(original.selectedRange, XgentCodeLocation(request: "reference:1", line: 150, endLine: nil, column: nil).range(in: content))
        original.selectedRange = NSRange(location: 120, length: 0)
        original.setContentOffset(CGPoint(x: 0, y: 240), animated: false)
        #else
        XCTAssertEqual(original.selectedRange(), XgentCodeLocation(request: "reference:1", line: 150, endLine: nil, column: nil).range(in: content))
        original.setSelectedRange(NSRange(location: 120, length: 0))
        let scroll = try XCTUnwrap(original.enclosingScrollView)
        scroll.contentView.scroll(to: CGPoint(x: 0, y: 240)); scroll.reflectScrolledClipView(scroll.contentView)
        #endif
        try await Task.sleep(nanoseconds: 100_000_000)
        let second = try fixture(surface: "second", key: "b:2", content: content)
        model.update(second); host.rootView = AnyView(render(second, model))
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertFalse(editor(in: host) === original)
        let returned = try fixture(surface: "returned", key: "a:1", content: content, request: "reference:1", line: 150)
        model.update(returned); host.rootView = AnyView(render(returned, model))
        try await Task.sleep(nanoseconds: 600_000_000)
        let restored = try XCTUnwrap(editor(in: host))
        #if os(iOS)
        XCTAssertEqual(restored.selectedRange, NSRange(location: 120, length: 0))
        XCTAssertEqual(restored.contentOffset.y, 240, accuracy: 3)
        #else
        XCTAssertEqual(restored.selectedRange(), NSRange(location: 120, length: 0))
        XCTAssertEqual(try XCTUnwrap(restored.enclosingScrollView).contentView.bounds.origin.y, 240, accuracy: 3)
        #endif
        let nextReference = try fixture(surface: "returned", key: "a:1", content: content, revision: 2, request: "reference:2", line: 3)
        model.update(nextReference); host.rootView = AnyView(render(nextReference, model))
        try await Task.sleep(nanoseconds: 300_000_000)
        let expected = XgentCodeLocation(request: "reference:2", line: 3, endLine: nil, column: nil).range(in: content)
        #if os(iOS)
        XCTAssertEqual(restored.selectedRange, expected)
        #else
        XCTAssertEqual(restored.selectedRange(), expected)
        #endif
    }

    @MainActor @ViewBuilder private func render(_ document: XgentDocument, _ model: XgentPresentationModel) -> some View {
        XgentTextArea(node: document.nodes[0], document: document, model: model).id(document.surface)
            .frame(width: 640, height: 360)
    }
    #if os(iOS)
    @MainActor private func editor(in host: UIHostingController<AnyView>) -> UITextView? {
        func find(_ view: UIView) -> UITextView? {
            if let input = view as? UITextView, input.isEditable { return input }
            return view.subviews.lazy.compactMap { find($0) }.first
        }
        return find(host.view)
    }
    #else
    @MainActor private func editor(in host: NSHostingView<AnyView>) -> NSTextView? {
        func find(_ view: NSView) -> NSTextView? {
            if let input = view as? NSTextView, input.isEditable { return input }
            return view.subviews.lazy.compactMap { find($0) }.first
        }
        return find(host)
    }
    #endif
    private func fixture(surface: String, key: String, content: String, revision: Int = 1, request: String? = nil, line: Int = 1) throws -> XgentDocument {
        var metadata: [String: Any] = ["session": ["scope": "test-workspace", "key": key, "open": ["a:1", "b:2"]]]
        if let request { metadata["request"] = request; metadata["line"] = line }
        let text = try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: metadata), encoding: .utf8))
        let payload: [String: Any] = ["version": 1, "surface": surface, "revision": revision, "mode": "root", "title": key, "appearance": "system", "nodes": [
            ["id": "workspace-file-editor", "kind": "TextArea", "variant": "workspace-code-editor", "label": key, "language": "swift", "value": content, "text": text, "action": "edit", "fill": true]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
