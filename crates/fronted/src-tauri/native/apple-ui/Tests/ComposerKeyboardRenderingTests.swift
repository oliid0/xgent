#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class ComposerKeyboardRenderingTests: XCTestCase {
    @MainActor func testPhysicalReturnShiftReturnAndCommandReturnUseTheNativeDraft() async throws {
        let accessibility = try NativeMacAccessibilitySession(); defer { accessibility.restore() }
        let document = try fixture(menu: false)
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let window = show(document, model: model)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(for: .milliseconds(220))
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView)
        editor.setSelectedRange(NSRange(location: editor.string.utf16.count, length: 0))
        try press(36, "\r", modifiers: .shift, in: window)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(editor.string.hasSuffix("\n"), "Shift+Return inserts a real newline")
        XCTAssertFalse(actions.contains { $0.action == "submit" || $0.action == "steer" })
        try press(36, "\r", in: window); try await Task.sleep(for: .milliseconds(100))
        let submit = try XCTUnwrap(actions.last { $0.action == "submit" })
        XCTAssertEqual(submit.value.text, editor.string)
        model.complete(.init(surface: document.surface, requestId: submit.requestId, ok: true, error: nil))
        try press(36, "\r", modifiers: .command, in: window)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(actions.last?.action, "steer")
        XCTAssertEqual(actions.last?.value.text, editor.string)
    }

    @MainActor func testPhysicalMenuKeysChooseARealCandidateAndEscapeClosesOnlyTheMenu() async throws {
        let accessibility = try NativeMacAccessibilitySession(); defer { accessibility.restore() }
        let document = try fixture(menu: true)
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let window = show(document, model: model)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(for: .milliseconds(220))
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView)
        editor.setSelectedRange(NSRange(location: 1, length: 0))
        let count = actions.count
        try press(125, "\u{f701}", in: window)
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertEqual(actions.count, count, "Arrow keys select locally")
        try press(48, "\t", in: window); try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(actions.last?.action, "mention:1")
        try press(53, "\u{1b}", in: window); try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(actions.last?.action, "dismiss-menu")
        XCTAssertFalse(actions.contains { $0.action == "submit" || $0.action == "steer" })
    }

    @MainActor func testPhysicalReturnWhileComposingCannotSend() async throws {
        let document = try fixture(menu: false)
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let window = show(document, model: model)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(for: .milliseconds(220))
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView)
        editor.setMarkedText("拼音", selectedRange: NSRange(location: 2, length: 0), replacementRange: editor.selectedRange())
        XCTAssertTrue(editor.hasMarkedText())
        try press(36, "\r", in: window); try await Task.sleep(for: .milliseconds(50))
        XCTAssertFalse(actions.contains { $0.action == "submit" || $0.action == "steer" })
    }

    @MainActor private func show(_ document: XgentDocument, model: XgentPresentationModel) -> NSWindow {
        let host = NSHostingView(rootView: XgentRootLayout(model: model))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 480),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded(); return window
    }

    @MainActor private func press(_ code: UInt16, _ characters: String, modifiers: NSEvent.ModifierFlags = [], in window: NSWindow) throws {
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            window.sendEvent(try XCTUnwrap(NSEvent.keyEvent(with: type, location: .zero, modifierFlags: modifiers, timestamp: 0,
                windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters,
                isARepeat: false, keyCode: code)))
        }
    }

    private func fixture(menu: Bool) throws -> XgentDocument {
        let input: [String: Any] = ["id": "draft", "kind": "ComposerInput", "label": "Message", "value": menu ? "/" : "a😀z",
            "action": "draft", "selectionAction": "selection", "focusRequest": 1, "children": [
                ["id": "draft-keyboard-submit", "kind": "Button", "label": "Send", "action": "submit"],
                ["id": "draft-keyboard-steer", "kind": "Button", "label": "Run now", "action": "steer"],
                ["id": "draft-keyboard-dismiss", "kind": "Button", "label": "Close suggestions", "action": "dismiss-menu"],
            ]]
        let suggestions: [String: Any] = ["id": "composer-suggestions", "kind": "List", "variant": "composer-suggestions", "value": "[\"conversation\",\"/project\",\"/\",0,1]", "children":
            (0..<3).map { ["id": "mention:\($0)", "kind": "Button", "label": "Skill \($0)", "action": "mention:\($0)"] }]
        let nodes: [[String: Any]] = menu ? [suggestions, input] : [input]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "keyboard", "revision": 1, "mode": "root", "title": "Chat", "appearance": "light", "formFactor": "desktop",
            "nodes": [["id": "composer", "kind": "Composer", "children": nodes]],
        ]))
        try document.validate(); return document
    }
}
#endif
