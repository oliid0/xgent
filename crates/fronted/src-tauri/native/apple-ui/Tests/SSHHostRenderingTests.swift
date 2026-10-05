import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class SSHHostRenderingTests: XCTestCase {
    @MainActor func testHostDetailsAndActionsFitNarrowLargeTextWithoutOverlapping() async throws {
        #if os(macOS)
        let accessibility = try NativeMacAccessibilitySession(); defer { accessibility.restore() }
        #endif
        for size in [DynamicTypeSize.large, .accessibility3] {
            let document = try fixture()
            let model = XgentPresentationModel(); model.update(document)
            var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
            let content = ScrollView {
                XgentSSHHostRow(node: document.nodes[0], document: document, model: model).padding(16)
            }.frame(width: 320, height: 720).dynamicTypeSize(size)
            #if os(iOS)
            let host = UIHostingController(rootView: content); host.safeAreaRegions = []
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 720))
            window.rootViewController = host; window.makeKeyAndVisible()
            defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(160))
            let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
            let elements = hierarchy.flattenToElements()
            var frames: [CGRect] = []
            for id in ["host:edit", "host:reset-known-host", "host:delete"] {
                let element = try XCTUnwrap(elements.first { $0.identifier == id })
                let frame = element.shape.bezierPath.bounds
                XCTAssertGreaterThanOrEqual(frame.height, 44); XCTAssertGreaterThanOrEqual(frame.width, 44)
                XCTAssertGreaterThanOrEqual(frame.minX, -1); XCTAssertLessThanOrEqual(frame.maxX, 321)
                XCTAssertFalse(frames.contains { $0.intersects(frame) }); frames.append(frame)
            }
            try attachNativeAccessibilityEvidence(hierarchy, name: "ssh-host-320-\(size)")
            try attachCompositedNativeScreenshot(of: host.view, name: "ssh-host-320-\(size)")
            #else
            let host = NSHostingView(rootView: content)
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 320, height: 720), styleMask: [.titled], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(160))
            let elements = nativeMacAccessibilityTree(window)
            var frames: [CGRect] = []
            for id in ["host:edit", "host:reset-known-host", "host:delete"] {
                let element = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == id })
                let frame = element.accessibilityFrame()
                XCTAssertGreaterThanOrEqual(frame.height, 44); XCTAssertGreaterThanOrEqual(frame.width, 44)
                XCTAssertFalse(frames.contains { $0.intersects(frame) }); frames.append(frame)
            }
            let reset = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "host:reset-known-host" })
            XCTAssertTrue(reset.accessibilityPerformPress()); try await Task.sleep(for: .milliseconds(60))
            XCTAssertEqual(actions.last?.action, "reset-known-host")
            #endif
        }
    }

    private func fixture() throws -> XgentDocument {
        #if os(iOS)
        let formFactor = "mobile"
        #else
        let formFactor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "settings:ssh", "revision": 1, "mode": "sheet", "title": "SSH",
            "appearance": "light", "formFactor": formFactor, "nodes": [["id": "host", "kind": "VStack", "variant": "ssh-host-row",
            "label": "Work server with a long readable name", "children": [
                ["id": "host:edit", "kind": "NavigationRow", "label": "user@long-server-name.example.test:2222", "accessibilityLabel": "Edit host", "action": "edit"],
                ["id": "host:auth", "kind": "Badge", "label": "Private key authentication"],
                ["id": "host:known-host-status", "kind": "StatusDot", "label": "The remembered fingerprint has been removed", "status": "completed"],
                ["id": "host:reset-known-host", "kind": "IconButton", "label": "Reset remembered fingerprint", "icon": "shield.lefthalf.filled", "action": "reset-known-host"],
                ["id": "host:delete", "kind": "Button", "label": "Delete host", "action": "delete", "destructive": true],
            ]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
