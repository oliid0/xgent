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
        try await Task.sleep(nanoseconds: 220_000_000)
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView)
        editor.setSelectedRange(NSRange(location: editor.string.utf16.count, length: 0))
        try press(36, "\r", modifiers: .shift, in: window)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(editor.string.hasSuffix("\n"), "Shift+Return inserts a real newline")
        XCTAssertFalse(actions.contains { $0.action == "submit" || $0.action == "steer" })
        try press(36, "\r", in: window); try await Task.sleep(nanoseconds: 100_000_000)
        let submit = try XCTUnwrap(actions.last { $0.action == "submit" })
        XCTAssertEqual(submit.value.text, editor.string)
        model.complete(.init(surface: document.surface, requestId: submit.requestId, ok: true, error: nil))
        try press(36, "\r", modifiers: .command, in: window)
        try await Task.sleep(nanoseconds: 100_000_000)
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
        try await Task.sleep(nanoseconds: 220_000_000)
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView)
        editor.setSelectedRange(NSRange(location: 1, length: 0))
        // Explicit caret placement reports its selection asynchronously. Finish
        // that setup before measuring the actions caused by the physical arrow.
        try await Task.sleep(nanoseconds: 100_000_000)
        let count = actions.count
        try press(125, "\u{f701}", in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(actions.count, count, "Arrow keys select locally; unexpected actions: \(actions.dropFirst(count).map(\.action))")
        try press(48, "\t", in: window); try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(actions.last?.action, "mention:1")
        try press(53, "\u{1b}", in: window); try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(actions.last?.action, "dismiss-menu")
        XCTAssertFalse(actions.contains { $0.action == "submit" || $0.action == "steer" })
    }

    @MainActor func testPhysicalReturnWhileComposingCannotSend() async throws {
        let document = try fixture(menu: false)
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let window = show(document, model: model)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(nanoseconds: 220_000_000)
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView)
        editor.setMarkedText("拼音", selectedRange: NSRange(location: 2, length: 0), replacementRange: editor.selectedRange())
        XCTAssertTrue(editor.hasMarkedText())
        try press(36, "\r", in: window); try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertFalse(actions.contains { $0.action == "submit" || $0.action == "steer" })
    }

    @MainActor func testPhysicalHistoryArrowsCarryUTF16CaretAndRespectSelectionModifiersAndLogicalLines() async throws {
        let accessibility = try NativeMacAccessibilitySession(); defer { accessibility.restore() }
        let document = try fixture(menu: false, history: true)
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []
        model.actionSink = { action in
            actions.append(action)
            model.complete(.init(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
        }
        let window = show(document, model: model)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(nanoseconds: 220_000_000)
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView)
        editor.setSelectedRange(NSRange(location: editor.string.utf16.count, length: 0))
        try await Task.sleep(nanoseconds: 60_000_000)
        try press(126, "\u{f700}", in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        let previous = try XCTUnwrap(actions.last { $0.action == "history-prev" })
        let caret = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(previous.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(caret["text"] as? String, "a😀z")
        XCTAssertEqual(caret["location"] as? Int, 4, "Native history uses UTF-16 offsets")
        XCTAssertEqual(caret["length"] as? Int, 0)
        let count = actions.filter { $0.action.hasPrefix("history-") }.count
        try press(126, "\u{f700}", modifiers: .shift, in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(actions.filter { $0.action.hasPrefix("history-") }.count, count)
        editor.setSelectedRange(NSRange(location: 0, length: 1))
        try press(126, "\u{f700}", in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(actions.filter { $0.action.hasPrefix("history-") }.count, count)

        let multiline = try fixture(menu: false, history: true, text: "first\nlast", revision: 2)
        model.update(multiline)
        try await Task.sleep(nanoseconds: 100_000_000)
        editor.setSelectedRange(NSRange(location: 8, length: 0))
        try press(126, "\u{f700}", in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(actions.filter { $0.action.hasPrefix("history-") }.count, count,
            "Up inside the second logical line remains ordinary caret movement")
        editor.setSelectedRange(NSRange(location: 0, length: 0))
        try press(125, "\u{f701}", in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(actions.filter { $0.action.hasPrefix("history-") }.count, count,
            "Down inside the first logical line remains ordinary caret movement")
        editor.setSelectedRange(NSRange(location: editor.string.utf16.count, length: 0))
        try press(125, "\u{f701}", in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(actions.last { $0.action.hasPrefix("history-") }?.action, "history-next")
        XCTAssertFalse(actions.contains { $0.action == "submit" || $0.action == "steer" })
    }

    @MainActor func testPhysicalReferenceKeysUseCurrentCaretAndPreserveNativeModifierEditing() async throws {
        let accessibility = try NativeMacAccessibilitySession(); defer { accessibility.restore() }
        let document = try fixture(menu: false, tokens: true, text: "😀 /review next")
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []
        model.actionSink = { action in
            actions.append(action)
            model.complete(.init(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
        }
        let window = show(document, model: model)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(nanoseconds: 220_000_000)
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView)
        for (location, code, characters, expected) in [
            (3, UInt16(124), "\u{f703}", "right"),
            (10, UInt16(123), "\u{f702}", "left"),
            (10, UInt16(51), "\u{7f}", "backspace"),
            (3, UInt16(117), "\u{f728}", "delete"),
        ] {
            editor.setSelectedRange(NSRange(location: location, length: 0))
            try await Task.sleep(nanoseconds: 60_000_000)
            try press(code, characters, in: window)
            try await Task.sleep(nanoseconds: 60_000_000)
            let action = try XCTUnwrap(actions.last { $0.action.hasPrefix("atomic-") })
            XCTAssertEqual(action.action, "atomic-\(expected)")
            let value = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(action.value.text.utf8)) as? [String: Any])
            XCTAssertEqual(value["text"] as? String, "😀 /review next")
            XCTAssertEqual(value["location"] as? Int, location)
            XCTAssertEqual(editor.string, "😀 /review next", "Shared action owns the complete token mutation")
        }
        let count = actions.filter { $0.action.hasPrefix("atomic-") }.count
        editor.setSelectedRange(NSRange(location: 10, length: 0))
        try press(123, "\u{f702}", modifiers: .shift, in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(actions.filter { $0.action.hasPrefix("atomic-") }.count, count)
        editor.setSelectedRange(NSRange(location: 13, length: 0))
        try press(123, "\u{f702}", in: window)
        try await Task.sleep(nanoseconds: 60_000_000)
        XCTAssertEqual(actions.filter { $0.action.hasPrefix("atomic-") }.count, count)
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

    private func fixture(menu: Bool, history: Bool = false, tokens: Bool = false, text: String = "a😀z", revision: Int = 1) throws -> XgentDocument {
        var keyboard: [[String: Any]] = [
            ["id": "draft-keyboard-submit", "kind": "Button", "label": "Send", "action": "submit"],
            ["id": "draft-keyboard-steer", "kind": "Button", "label": "Run now", "action": "steer"],
            ["id": "draft-keyboard-dismiss", "kind": "Button", "label": "Close suggestions", "action": "dismiss-menu"],
        ]
        if history {
            keyboard += [
                ["id": "draft-keyboard-history-prev", "kind": "Button", "label": "Previous prompt", "action": "history-prev"],
                ["id": "draft-keyboard-history-next", "kind": "Button", "label": "Next prompt", "action": "history-next"],
            ]
        }
        if tokens {
            keyboard += ["left", "right", "backspace", "delete"].map { key in
                ["id": "draft-keyboard-atomic-\(key)", "kind": "Button", "label": key,
                 "action": "atomic-\(key)", "value": "[{\"location\":3,\"length\":7}]"]
            }
        }
        let input: [String: Any] = ["id": "draft", "kind": "ComposerInput", "label": "Message", "value": menu ? "/" : text,
            "action": "draft", "selectionAction": "selection", "focusRequest": 1, "children": keyboard]
        let suggestions: [String: Any] = ["id": "composer-suggestions", "kind": "List", "variant": "composer-suggestions", "value": "[\"conversation\",\"/project\",\"/\",0,1]", "children":
            (0..<3).map { ["id": "mention:\($0)", "kind": "Button", "label": "Skill \($0)", "action": "mention:\($0)"] }]
        let nodes: [[String: Any]] = menu ? [suggestions, input] : [input]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "keyboard", "revision": revision, "mode": "root", "title": "Chat", "appearance": "light", "formFactor": "desktop",
            "nodes": [["id": "composer", "kind": "Composer", "children": nodes]],
        ]))
        try document.validate(); return document
    }
}
#endif
