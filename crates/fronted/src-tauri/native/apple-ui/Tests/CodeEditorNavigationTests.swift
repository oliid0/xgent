#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class CodeEditorNavigationTests: XCTestCase {
    @MainActor func testEditingCommandsFindAndUndoInTheActualMacCodeView() async throws {
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        model.update(try fixture("let count = 1", location: #"{"request":"1","line":1}"#))
        let host = NSHostingView(rootView: XgentRootLayout(model: model))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(nanoseconds: 500_000_000)
        let input = try XCTUnwrap(editor(in: host)), commands = XgentCodeEditingCommands()
        commands.attach(input); try await Task.sleep(nanoseconds: 100_000_000)
        commands.find(replacing: true); try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(try XCTUnwrap(input.enclosingScrollView).isFindBarVisible)
        let hide = NSMenuItem(); hide.tag = Int(NSTextFinder.Action.hideFindInterface.rawValue)
        input.performTextFinderAction(hide)
        window.makeFirstResponder(input)
        input.setSelectedRange(NSRange(location: input.string.utf16.count, length: 0))
        input.insertText(" // Added", replacementRange: input.selectedRange())
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(commands.canUndo)
        commands.undo(); try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(input.string, "let count = 1")
        XCTAssertEqual(actions.last?.value, .string("let count = 1"))
        commands.redo(); try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(input.string, "let count = 1 // Added")
        window.orderOut(nil)
        commands.undo(); XCTAssertEqual(input.string, "let count = 1 // Added")
    }

    @MainActor func testReferenceNavigationScrollsAndAcknowledgementDoesNotResetTheCaret() async throws {
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let prefix = (1...100).map { "let line\($0) = \($0)" }.joined(separator: "\n") + "\n"
        let content = prefix + "let result = \"中文 😀\"\n"
        let location = #"{"request":"1","line":101,"column":5}"#
        model.update(try fixture(content, location: location))
        let host = NSHostingView(rootView: XgentRootLayout(model: model))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 320), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(nanoseconds: 500_000_000)
        let input = try XCTUnwrap(editor(in: host))
        XCTAssertEqual(input.selectedRange(), try XCTUnwrap(XgentCodeLocation.decode(location)).range(in: content))
        XCTAssertGreaterThan(try XCTUnwrap(input.enclosingScrollView).contentView.bounds.origin.y, 0)
        window.makeFirstResponder(input)
        input.setSelectedRange(NSRange(location: input.string.utf16.count, length: 0))
        input.insertText("// Later input", replacementRange: input.selectedRange())
        try await Task.sleep(nanoseconds: 100_000_000)
        let action = try XCTUnwrap(actions.last), caret = input.selectedRange()
        model.complete(XgentActionResult(surface: "code-navigation", requestId: action.requestId, ok: true, error: nil, acceptedValue: action.value))
        model.update(try fixture(action.value.text, revision: 2, location: location))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(editor(in: host) === input)
        XCTAssertEqual(input.selectedRange(), caret)
        model.update(try fixture(action.value.text, revision: 3, location: #"{"request":"2","line":1}"#))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(input.selectedRange().location, 0)
    }

    @MainActor private func editor(in view: NSView) -> NSTextView? {
        if let text = view as? NSTextView, text.isEditable { return text }
        return view.subviews.lazy.compactMap { editor(in: $0) }.first
    }

    private func fixture(_ content: String, revision: Int = 1, location: String) throws -> XgentDocument {
        let payload: [String: Any] = ["version": 1, "surface": "code-navigation", "revision": revision, "mode": "root", "title": "Example.swift", "appearance": "system", "formFactor": "desktop", "nodes": [
            ["id": "file", "kind": "BrowserLayout", "fill": true, "children": [
                ["id": "code", "kind": "TextArea", "variant": "workspace-code-editor", "label": "Example.swift", "language": "swift", "value": content,
                 "text": location, "action": "edit", "fill": true]]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
#endif
