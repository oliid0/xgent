import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

@MainActor
private final class StartupActions {
    var values: [XgentAction] = []
    func record(_ action: XgentAction) { values.append(action) }
}

final class StartupRenderingTests: XCTestCase {
    @MainActor
    func testDegradedServiceReloadUsesSharedBridgeAndCannotRunAfterRecovery() throws {
        let model = XgentPresentationModel(), actions = StartupActions()
        model.actionSink = actions.record
        let status = try serviceStatus(), reload = try XCTUnwrap(status.node(id: "startup:reload"))
        model.update(status)
        model.send(reload, in: status)
        model.send(reload, in: status)
        XCTAssertEqual(actions.values.map(\.action), ["startup:reload"])
        model.update(try decode([
            "version": 1, "surface": status.surface, "revision": 2, "mode": "root", "title": "",
            "appearance": "system", "removed": true, "nodes": [],
        ]))
        model.send(reload, in: status)
        XCTAssertEqual(actions.values.count, 1)
        XCTAssertTrue(model.documents.isEmpty)
    }

    @MainActor
    func testWaitingFailureAndDegradedIndependentPageRenderAtNarrowWideAndAccessibilitySizes() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        let factor = "mobile"
        #else
        let widths: [CGFloat] = [640, 1040]
        let factor = "desktop"
        #endif
        for width in widths {
            for state in ["waiting", "failure", "degraded"] {
                for size in [DynamicTypeSize.large, .accessibility3] {
                    let model = XgentPresentationModel()
                    let nodes: [[String: Any]]
                    switch state {
                    case "failure":
                        nodes = [["id": "startup:failure", "kind": "Banner", "variant": "error-screen",
                                  "label": "Settings unavailable", "text": "The native settings service could not be reached. Reload to retry.",
                                  "status": "error", "children": [["id": "startup:reload", "kind": "Button", "label": "Reload", "action": "startup:reload"]]]]
                    case "degraded":
                        nodes = [["id": "path", "kind": "TextInput", "label": "Workspace path", "value": "/Documents/Fort Mason", "action": "path"]]
                    default: nodes = []
                    }
                    model.update(try decode([
                        "version": 1, "surface": "page", "revision": 1, "mode": "root",
                        "title": state == "degraded" ? "Workspace" : "", "appearance": "dark",
                        "formFactor": factor, "nodes": nodes,
                    ]))
                    if state == "degraded" { model.update(try serviceStatus()) }
                    let view = XgentPresentationView(model: model).frame(width: width, height: 720)
                        .dynamicTypeSize(size)
                        .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .dark))
                    #if os(iOS)
                    let hosting = UIHostingController(rootView: view)
                    hosting.view.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                    hosting.view.layoutIfNeeded()
                    let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(hosting.view).run { continuation.resume(returning: $0) }
                    }
                    XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 1000)
                    #else
                    let hosting = NSHostingView(rootView: view)
                    hosting.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                    hosting.layoutSubtreeIfNeeded()
                    let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(hosting).run { continuation.resume(returning: $0) }
                    }
                    XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 1000)
                    #endif
                    XCTAssertEqual(image.size.width, width)
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "startup-\(state)-\(Int(width))-\(size == .large ? "standard" : "accessibility")"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
        }
    }

    private func serviceStatus() throws -> XgentDocument {
        try decode([
            "version": 1, "surface": "service-status", "revision": 1, "mode": "status", "title": "",
            "appearance": "dark", "nodes": [["id": "startup:status", "kind": "Banner", "variant": "service-status",
                "label": "Some mobile services did not start", "text": String(repeating: "The history database is unavailable. Independent workspace settings remain usable. ", count: 6),
                "status": "pending", "children": [["id": "startup:reload", "kind": "Button", "label": "Reload", "action": "startup:reload"]]]],
        ])
    }

    private func decode(_ value: [String: Any]) throws -> XgentDocument {
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: value))
        try document.validate()
        return document
    }
}
