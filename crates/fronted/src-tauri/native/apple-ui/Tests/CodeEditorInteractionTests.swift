#if os(iOS)
import Foundation
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

@MainActor
private final class CodeActionRecorder {
    var actions: [XgentAction] = []
    func record(_ action: XgentAction) { actions.append(action) }
}

final class CodeEditorInteractionTests: XCTestCase {
    @MainActor
    func testNativeTypingUsesTheRealEditBridgeAndAcknowledgementsKeepTheCaret() async throws {
        let model = XgentPresentationModel()
        let bridge = CodeActionRecorder()
        model.actionSink = bridge.record
        let initial = try document(content: "let message = \"Hello\"")
        model.update(initial)
        let (window, _) = mounted(model)
        defer { window.isHidden = true; window.rootViewController = nil }
        try await settle()
        let input = try XCTUnwrap(editor(in: window))
        XCTAssertEqual(input.autocapitalizationType, .none)
        XCTAssertEqual(input.autocorrectionType, .no)
        XCTAssertEqual(input.smartQuotesType, .no)
        XCTAssertEqual(input.smartDashesType, .no)
        let suffix = " // 你好👋"
        input.selectedRange = NSRange(location: input.text.utf16.count, length: 0)
        XCTAssertTrue(input.becomeFirstResponder())
        input.insertText(suffix)
        try await settle()
        let expected = "let message = \"Hello\"" + suffix
        let action = try XCTUnwrap(bridge.actions.last)
        XCTAssertEqual(action.action, "edit")
        XCTAssertEqual(action.surface, "editor")
        XCTAssertEqual(action.value, .string(expected))
        let cursor = input.selectedRange
        model.complete(XgentActionResult(surface: "editor", requestId: action.requestId,
                                         ok: true, error: nil, acceptedValue: .string(expected)))
        model.update(try document(revision: 2, content: expected))
        try await settle()
        XCTAssertTrue(editor(in: window) === input)
        XCTAssertEqual(input.selectedRange, cursor)
        XCTAssertEqual(input.text, expected)
        XCTAssertTrue(model.edits.isEmpty)
    }

    @MainActor
    func testDisabledCodeEditorRemovesTheEditableViewAndRejectsItsLateCallback() async throws {
        let model = XgentPresentationModel()
        let bridge = CodeActionRecorder()
        model.actionSink = bridge.record
        model.update(try document(content: "let count = 1"))
        let (window, _) = mounted(model)
        defer { window.isHidden = true; window.rootViewController = nil }
        try await settle()
        let oldInput = try XCTUnwrap(editor(in: window))
        XCTAssertTrue(oldInput.becomeFirstResponder())
        let disabled = try document(revision: 2, content: "let count = 1", disabled: true)
        model.update(disabled)
        try await settle()
        XCTAssertNil(editor(in: window))
        XCTAssertFalse(oldInput.isFirstResponder)
        let count = bridge.actions.count
        oldInput.insertText("stale")
        try await settle()
        XCTAssertEqual(bridge.actions.count, count)
        XCTAssertTrue(model.edits.isEmpty)
        XCTAssertEqual(model.value(try XCTUnwrap(disabled.node(id: "code")), in: disabled), .string("let count = 1"))
    }

    @MainActor
    func testFileSurfaceChangeResetsSelectionAndScalesTheCodeFont() async throws {
        let model = XgentPresentationModel()
        let bridge = CodeActionRecorder()
        model.actionSink = bridge.record
        model.update(try document(content: "let longName = 12345"))
        let (window, controller) = mounted(model)
        defer { window.isHidden = true; window.rootViewController = nil }
        try await settle()
        let oldInput = try XCTUnwrap(editor(in: window))
        let initialFont = try XCTUnwrap(oldInput.font).pointSize
        oldInput.selectedRange = NSRange(location: 12, length: 0)
        model.update(try document(revision: 2, content: "", removed: true))
        model.update(try document(surface: "second", content: "x"))
        controller.rootView = AnyView(XgentRootLayout(model: model).dynamicTypeSize(.accessibility2))
        try await settle()
        let next = try XCTUnwrap(editor(in: window))
        XCTAssertFalse(next === oldInput)
        XCTAssertEqual(next.selectedRange, NSRange(location: 0, length: 0))
        XCTAssertGreaterThan(try XCTUnwrap(next.font).pointSize, initialFont)
        let count = bridge.actions.count
        oldInput.insertText("stale")
        try await settle()
        XCTAssertEqual(bridge.actions.count, count)
    }

    @MainActor
    private func mounted(_ model: XgentPresentationModel) -> (UIWindow, UIHostingController<AnyView>) {
        let controller = UIHostingController(rootView: AnyView(XgentRootLayout(model: model).dynamicTypeSize(.large)))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        controller.view.layoutIfNeeded()
        return (window, controller)
    }

    @MainActor
    private func editor(in view: UIView) -> UITextView? {
        if let textView = view as? UITextView, textView.isEditable { return textView }
        return view.subviews.lazy.compactMap { editor(in: $0) }.first
    }

    private func settle() async throws { try await Task.sleep(nanoseconds: 500_000_000) }

    private func document(surface: String = "editor", revision: Int = 1, content: String,
                          disabled: Bool = false, removed: Bool = false) throws -> XgentDocument {
        let json: [String: Any] = [
            "version": 1, "surface": surface, "revision": revision, "mode": "root", "title": "Example.swift",
            "appearance": "light", "formFactor": "mobile", "removed": removed, "nodes": [
                ["id": "file", "kind": "BrowserLayout", "fill": true, "children": [
                    ["id": "code", "kind": "TextArea", "label": "Example.swift", "language": "swift",
                     "value": content, "action": "edit", "fill": true, "disabled": disabled],
                ]],
            ],
        ]
        let result = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try result.validate()
        return result
    }
}
#endif
