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
            "nodes": [
                ["id": "draft", "kind": "TextInput", "label": "Message", "value": "Draft", "action": "edit"],
                ["id": "native-action", "kind": "Button", "label": "Native action", "action": "send"],
            ]]
        let data = try JSONSerialization.data(withJSONObject: document)
        let status = try XCTUnwrap(String(data: data, encoding: .utf8)).withCString {
            xgentNativeUIUpdate(pointer, nil, $0, false)
        }
        XCTAssertEqual(status, 0)
        container.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let native = try XCTUnwrap(container.subviews.first { $0 !== transport })
        let children = try XCTUnwrap(container.accessibilityChildren()).compactMap { $0 as? NSView }
        XCTAssertTrue(children.contains { $0 === native })
        XCTAssertFalse(children.contains { $0 === transport }, "The covered execution host must not own accessibility")
        XCTAssertTrue(transport.window === window)
        XCTAssertFalse(transport.isHidden, "The shared execution host must continue running")

        let action = try XCTUnwrap(nativeMacAccessibilityTree(native).first { $0.accessibilityIdentifier() == "native-action" })
        let frame = action.accessibilityFrame()
        XCTAssertGreaterThan(frame.width, 0)
        let windowPoint = window.convertPoint(fromScreen: NSPoint(x: frame.midX, y: frame.midY))
        let point = container.convert(windowPoint, from: nil)
        let hit = try XCTUnwrap(container.hitTest(point))
        XCTAssertTrue(hit === native || hit.isDescendant(of: native), "Pointer input must reach the native presentation")
        XCTAssertFalse(hit === transport || hit.isDescendant(of: transport))
        let value = try await transport.evaluateJavaScript("6 * 7")
        XCTAssertEqual((value as? NSNumber)?.intValue, 42, "Native accessibility must preserve shared JS execution")
        XCTAssertTrue(action.accessibilityPerformPress())
        let actionDeadline = ContinuousClock.now + .seconds(3)
        var emitted: [String: Any]?
        while emitted == nil, ContinuousClock.now < actionDeadline {
            emitted = try await transport.evaluateJavaScript("window.nativeActions[0] ?? null") as? [String: Any]
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
