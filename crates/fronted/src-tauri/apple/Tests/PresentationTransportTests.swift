#if os(macOS)
import AppKit
import SwiftUI
import WebKit
import XCTest
@testable import XgentNativeUI

final class PresentationTransportTests: XCTestCase {
    @MainActor
    func testActualHostOwnsNativeInputAndAccessibilityWithoutSuspendingExecution() async throws {
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 870, height: 576),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        let container = try XCTUnwrap(window.contentView)
        let transport = WKWebView(frame: container.bounds)
        transport.autoresizingMask = [.width, .height]
        container.addSubview(transport)
        window.makeKeyAndOrderFront(nil)
        let pointer = Unmanaged.passUnretained(transport).toOpaque()
        defer { xgentNativeUIReset(pointer); window.orderOut(nil); window.contentView = nil }

        transport.loadHTMLString("<button id='covered'>Covered transport</button>", baseURL: nil)
        let deadline = ContinuousClock.now + .seconds(10)
        while transport.isLoading, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertFalse(transport.isLoading)
        _ = try await transport.evaluateJavaScript("""
            window.nativeActions = [];
            window.addEventListener('xgent:native-action', event => {
                event.preventDefault(); window.nativeActions.push(event.detail);
            });
            """)
        let document: [String: Any] = ["version": 1, "surface": "page", "revision": 1,
            "mode": "root", "title": "Native host", "formFactor": "desktop", "appearance": "light",
            "nodes": [["id": "host-controls", "kind": "VStack", "children": [
                ["id": "draft", "kind": "ComposerInput", "label": "Message", "value": "", "action": "edit"],
                ["id": "native-action", "kind": "Button", "label": "Native action", "action": "send"],
            ]]]]
        let data = try JSONSerialization.data(withJSONObject: document)
        let status = try XCTUnwrap(String(data: data, encoding: .utf8)).withCString {
            xgentNativeUIUpdate(pointer, nil, $0, false)
        }
        XCTAssertEqual(status, 0)
        container.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let native = try XCTUnwrap(container.subviews.first { $0 !== transport })
        let children = try XCTUnwrap(container.accessibilityChildren())
        XCTAssertTrue(children.contains { ($0 as? NSView) === native },
                      "The sibling list must retain the actual native ancestor, not promoted SwiftUI proxies")
        XCTAssertTrue(native.isAccessibilityElement())
        XCTAssertEqual(native.accessibilityRole(), .group)
        let parent = try XCTUnwrap(native.accessibilityParent())
        let actualParent = try XCTUnwrap(NSAccessibility.unignoredAncestor(of: parent) as? NSObject)
        let expectedParent = try XCTUnwrap(NSAccessibility.unignoredAncestor(of: container) as? NSObject)
        XCTAssertTrue(actualParent === expectedParent,
                      "AXChildren and AXParent must agree for the real native container")
        XCTAssertFalse(children.contains { ($0 as? NSView) === transport }, "The covered execution host must not own accessibility")
        XCTAssertTrue(transport.isAccessibilityHidden())
        XCTAssertTrue(transport.window === window)
        XCTAssertFalse(transport.isHidden, "The shared execution host must continue running")

        let renderDeadline = ContinuousClock.now + .seconds(5)
        var nativeElements = nativeMacAccessibilityTree(native)
        while !nativeElements.contains(where: { $0.accessibilityIdentifier() == "native-action" }),
              ContinuousClock.now < renderDeadline {
            try await Task.sleep(for: .milliseconds(50))
            native.layoutSubtreeIfNeeded()
            nativeElements = nativeMacAccessibilityTree(native)
        }
        try attachNativeAccessibilityEvidence(nativeElements.map {
            ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityText() ?? ""]
        }, name: "actual-transport-host")
        let action = try XCTUnwrap(nativeElements.first { $0.accessibilityIdentifier() == "native-action" })
        let exposed = children.flatMap { nativeMacAccessibilityTree($0) }
        XCTAssertTrue(exposed.contains { $0.accessibilityIdentifier() == "draft" })
        XCTAssertTrue(exposed.contains { $0.accessibilityIdentifier() == "native-action" })
        let frame = action.accessibilityFrame()
        XCTAssertGreaterThan(frame.width, 0)
        let windowPoint = window.convertPoint(fromScreen: NSPoint(x: frame.midX, y: frame.midY))
        let point = container.convert(windowPoint, from: nil)
        let hit = try XCTUnwrap(container.hitTest(point))
        XCTAssertTrue(hit === native || hit.isDescendant(of: native), "Pointer input must reach the native presentation")
        XCTAssertFalse(hit === transport || hit.isDescendant(of: transport))
        let screenPoint = NSPoint(x: frame.midX, y: frame.midY)
        let accessibilityHit = try XCTUnwrap(window.accessibilityHitTest(screenPoint) as? NSObject)
        XCTAssertEqual(NativeMacAccessibilityElement(object: accessibilityHit).accessibilityIdentifier(), "native-action",
                       "Accessibility hit testing must reach the same native control as pointer input")
        let draft = try XCTUnwrap(nativeElements.first { $0.accessibilityIdentifier() == "draft" })
        let draftFrame = draft.accessibilityFrame()
        let draftScreenPoint = NSPoint(x: draftFrame.midX, y: draftFrame.midY)
        let draftHit = try XCTUnwrap(window.accessibilityHitTest(draftScreenPoint) as? NSObject)
        XCTAssertEqual(NativeMacAccessibilityElement(object: draftHit).accessibilityIdentifier(), "draft",
                       "The real multiline composer must be reachable through native accessibility")
        let draftPoint = window.convertPoint(fromScreen: draftScreenPoint)
        let click = try [NSEvent.EventType.leftMouseDown, .leftMouseUp].enumerated().map { index, type in
            try XCTUnwrap(NSEvent.mouseEvent(with: type, location: draftPoint,
                modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: index + 1, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0))
        }
        NSApp.postEvent(click[1], atStart: true)
        window.sendEvent(click[0])
        if let release = NSApp.nextEvent(matching: .leftMouseUp, until: Date(), inMode: .default, dequeue: true) {
            window.sendEvent(release)
        }
        try await Task.sleep(for: .milliseconds(100))
        let editor = try XCTUnwrap(window.firstResponder as? NSTextView,
                                  "Clicking the composer must focus its actual native field editor")
        XCTAssertTrue(editor.isEditable)
        XCTAssertTrue(editor.isAccessibilityEnabled(), "The real editable text view must accept accessibility input")
        XCTAssertEqual(editor.string, "", "A new conversation must expose its empty composer before focus")
        editor.setSelectedRange(NSRange(location: editor.string.utf16.count, length: 0))
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            window.sendEvent(try XCTUnwrap(NSEvent.keyEvent(with: type, location: .zero,
                modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil,
                characters: "x", charactersIgnoringModifiers: "x", isARepeat: false, keyCode: 7)))
        }
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(editor.string, "x", "Physical keyboard input must edit the native composer")
        let draftDeadline = ContinuousClock.now + .seconds(3)
        var edited: [String: Any]?
        while edited == nil, ContinuousClock.now < draftDeadline {
            edited = try await transport.evaluateJavaScript("window.nativeActions.find(action => action.action === 'edit') ?? null") as? [String: Any]
            if edited == nil { try await Task.sleep(for: .milliseconds(50)) }
        }
        XCTAssertEqual(try XCTUnwrap(edited)["value"] as? String, "x",
                       "The clicked and typed draft must reach the shared execution host")
        let value = try await transport.evaluateJavaScript("6 * 7")
        XCTAssertEqual((value as? NSNumber)?.intValue, 42, "Native accessibility must preserve shared JS execution")
        XCTAssertTrue(action.accessibilityPerformPress())
        let actionDeadline = ContinuousClock.now + .seconds(3)
        var emitted: [String: Any]?
        while emitted == nil, ContinuousClock.now < actionDeadline {
            emitted = try await transport.evaluateJavaScript("window.nativeActions.find(action => action.action === 'send') ?? null") as? [String: Any]
            if emitted == nil { try await Task.sleep(for: .milliseconds(50)) }
        }
        let delivered = try XCTUnwrap(emitted)
        XCTAssertEqual(delivered["surface"] as? String, "page")
        XCTAssertEqual(delivered["action"] as? String, "send")
        let result: [String: Any] = ["surface": "page", "requestId": try XCTUnwrap(delivered["requestId"]), "ok": true]
        let reply = try JSONSerialization.data(withJSONObject: result)
        let replyStatus = try XCTUnwrap(String(data: reply, encoding: .utf8)).withCString {
            xgentNativeUIUpdate(pointer, nil, $0, true)
        }
        XCTAssertEqual(replyStatus, 0, "The actual action acknowledgement must reach the native host")

        xgentNativeUIReset(pointer)
        XCTAssertTrue(container.subviews.contains { $0 === transport })
        XCTAssertFalse(container.subviews.contains { $0 === native })
        XCTAssertFalse(transport.isAccessibilityHidden())
        let restored = try await transport.evaluateJavaScript("7 * 8")
        XCTAssertEqual((restored as? NSNumber)?.intValue, 56)
    }
}
#endif
