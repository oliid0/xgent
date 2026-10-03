#if os(macOS)
import AppKit
import Carbon.HIToolbox
import Foundation
import KeyboardShortcuts
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class ShortcutRecorderTests: XCTestCase {
    @MainActor
    func testPhysicalKeysAndModifierOrderMatchTheSharedRustAccelerators() throws {
        XCTAssertEqual(XgentShortcutKeys.accelerator(try key(kVK_ANSI_K, [.command, .option, .shift, .control])),
                       "Ctrl+Shift+Alt+Super+KeyK")
        XCTAssertEqual(XgentShortcutKeys.accelerator(try key(kVK_ANSI_J, [.command], characters: "∆")), "Super+KeyJ")
        XCTAssertEqual(XgentShortcutKeys.accelerator(try key(kVK_ANSI_Period, [.control])), "Ctrl+Period")
        XCTAssertEqual(XgentShortcutKeys.accelerator(try key(kVK_F12, [.function])), "F12")
        XCTAssertEqual(XgentShortcutKeys.accelerator(try key(kVK_ANSI_KeypadPlus, [.control])), "Ctrl+NumpadAdd")
        XCTAssertNil(XgentShortcutKeys.accelerator(try key(kVK_Command, [.command])))
        XCTAssertEqual(Set(XgentShortcutKeys.codes.values).count, XgentShortcutKeys.codes.count)
        XCTAssertFalse(XgentShortcutKeys.display("Ctrl+Super+KeyJ").isEmpty)
    }

    @MainActor
    func testRecorderCapturesNativeEventsAndReturnUsesTheLatestDraftDespiteAnOlderDocument() throws {
        let capture = XgentShortcutCaptureView()
        capture.systemConflict = { _ in false }
        var events: [(String, String?)] = []
        capture.send = { events.append(($0, $1)) }
        capture.configure(accelerator: "", enabled: true)
        capture.keyDown(with: try key(kVK_ANSI_J, [.command]))
        capture.keyDown(with: try key(kVK_ANSI_J, [.command], repeated: true))
        capture.keyDown(with: try key(kVK_Command, [.command]))
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].0, "capture")
        XCTAssertEqual(events[0].1, "Super+KeyJ")
        // A delayed shared-state snapshot must not replace native typing.
        capture.configure(accelerator: "", enabled: true)
        capture.keyDown(with: try key(kVK_Return))
        XCTAssertEqual(events.last?.0, "confirm")
        XCTAssertEqual(events.last?.1, "Super+KeyJ")
        capture.keyDown(with: try key(kVK_Escape))
        capture.retire()
        XCTAssertEqual(events.filter { $0.0 == "cancel" }.count, 1)
        let count = events.count
        capture.keyDown(with: try key(kVK_ANSI_K, [.control]))
        XCTAssertEqual(events.count, count)
    }

    @MainActor
    func testSystemConflictAndWindowDeactivationDoNotCommitOrLeaveACaptureObserver() async throws {
        let capture = XgentShortcutCaptureView()
        capture.systemConflict = { _ in true }
        var phases: [String] = []
        capture.send = { phase, _ in phases.append(phase) }
        capture.configure(accelerator: "", enabled: true)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 480, height: 180),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = capture
        defer { capture.retire(); window.contentView = nil; window.orderOut(nil) }
        window.makeFirstResponder(capture)
        XCTAssertTrue(capture.performKeyEquivalent(with: try key(kVK_ANSI_J, [.command])))
        XCTAssertEqual(phases, ["systemConflict"])
        NotificationCenter.default.post(name: NSWindow.didResignKeyNotification, object: window)
        await Task.yield()
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(phases, ["systemConflict", "cancel"])
        capture.retire()
        NotificationCenter.default.post(name: NSWindow.didResignKeyNotification, object: window)
        await Task.yield()
        XCTAssertEqual(phases, ["systemConflict", "cancel"])
    }

    @MainActor
    func testShortcutBridgeEventsDoNotLockCaptureOrOverwriteTheSharedDisplayValue() throws {
        let document = try document()
        let model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let node = try XCTUnwrap(document.node(id: "shortcut:summon:capture"))
        for phase in ["capture", "confirm"] {
            model.send(node, in: document, value: .string("{\"phase\":\"\(phase)\",\"accelerator\":\"Super+KeyJ\"}"), continuous: true)
        }
        XCTAssertEqual(actions.count, 2)
        XCTAssertFalse(model.isBusy(node, in: document))
        XCTAssertEqual(model.value(node, in: document), .string(""))
        model.invalidate()
        model.send(node, in: document, continuous: true)
        XCTAssertEqual(actions.count, 2)
    }

    @MainActor
    func testShortcutSettingsRenderAtDesktopWidthsAndAccessibilitySizes() async throws {
        for width: CGFloat in [640, 1040] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try document()
                let model = XgentPresentationModel()
                model.update(document)
                let content = VStack(alignment: .leading, spacing: 20) {
                    ForEach(document.nodes) { node in XgentNodeView(node: node, document: document, model: model) }
                }.padding(20).dynamicTypeSize(size).frame(width: width, height: 480)
                let host = NSHostingView(rootView: content)
                host.frame = CGRect(x: 0, y: 0, width: width, height: 480)
                host.layoutSubtreeIfNeeded()
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 480))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 1000)
                let attachment = XCTAttachment(image: image)
                attachment.name = "shortcut-settings-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
                model.invalidate()
            }
        }
    }

    private func key(_ code: Int, _ flags: NSEvent.ModifierFlags = [], characters: String = "j", repeated: Bool = false) throws -> NSEvent {
        try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags,
            timestamp: 0, windowNumber: 0, context: nil, characters: characters,
            charactersIgnoringModifiers: characters, isARepeat: repeated, keyCode: UInt16(code)))
    }

    private func document() throws -> XgentDocument {
        let json: [String: Any] = ["version": 1, "surface": "shortcuts", "revision": 1,
            "mode": "sheet", "formFactor": "desktop", "title": "Global shortcuts", "appearance": "light",
            "nodes": [
                ["id": "shortcut:toggle:record", "kind": "Button", "label": "Change shortcut",
                 "variant": "shortcut-binding", "text": "Ctrl+Shift+KeyS", "action": "record"],
                ["id": "shortcut:summon:capture", "kind": "ShortcutRecorder", "label": "Bring Xgent to the foreground",
                 "text": "Press modifiers and one main key, then Return to save or Escape to cancel",
                 "value": "", "action": "capture"],
            ]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }
}
#endif
