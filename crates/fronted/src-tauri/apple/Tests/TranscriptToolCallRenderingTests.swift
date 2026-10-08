import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class TranscriptToolCallRenderingTests: XCTestCase {
    @MainActor func testTimelineStartsCompactWithoutHidingItsLatestTargetOrClippingLargeText() async throws {
        #if os(macOS)
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        #endif
        for width in [CGFloat(320), 768] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel(); model.update(document)
                let content = VStack(alignment: .leading, spacing: 12) {
                    ForEach(document.nodes) { node in
                        #if os(iOS)
                        XgentIOSNode(node: node, document: document, model: model)
                        #else
                        XgentNodeView(node: node, document: document, model: model)
                        #endif
                    }
                    Spacer(minLength: 0)
                }
                .padding(16).frame(width: width, height: 900, alignment: .topLeading)
                .dynamicTypeSize(size).background { XgentThemeBackground() }
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: size == .large ? .light : .dark))
                #if os(iOS)
                let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 900))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(200))
                let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view).flattenToElements()
                XCTAssertFalse(elements.contains { $0.identifier == "xgent-code-block" }, "Arguments and results start folded")
                XCTAssertTrue(elements.contains { $0.label.contains("git log --oneline") }, "The latest target remains visible")
                var frames: [CGRect] = []
                for id in ["single:disclosure", "group:disclosure"] {
                    let element = try XCTUnwrap(elements.first { $0.identifier == id && $0.traits.contains(.button) })
                    let frame = element.shape.bezierPath.bounds
                    XCTAssertGreaterThanOrEqual(frame.height, 43.5)
                    XCTAssertGreaterThanOrEqual(frame.minX, 15)
                    XCTAssertLessThanOrEqual(frame.maxX, width - 15)
                    for previous in frames { XCTAssertFalse(previous.intersects(frame)) }
                    frames.append(frame)
                }
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 900))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                #else
                let host = NSHostingView(rootView: content)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 900),
                    styleMask: [.borderless], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                defer { model.invalidate(); window.close() }
                try await Task.sleep(for: .milliseconds(200)); host.layoutSubtreeIfNeeded()
                let elements = nativeMacAccessibilityTree(window)
                XCTAssertFalse(elements.contains { $0.accessibilityIdentifier() == "xgent-code-block" })
                XCTAssertTrue(elements.contains { $0.accessibilityText()?.contains("git log --oneline") == true })
                let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
                var frames: [CGRect] = []
                for id in ["single:disclosure", "group:disclosure"] {
                    let element = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == id && $0.accessibilityRole() == .button })
                    let frame = element.accessibilityFrame()
                    XCTAssertGreaterThanOrEqual(frame.height, 23.5)
                    XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX + 15)
                    XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX - 15)
                    for previous in frames { XCTAssertFalse(previous.intersects(frame)) }
                    frames.append(frame)
                }
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 900))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                #endif
                let attachment = XCTAttachment(image: image)
                attachment.name = "work-process-collapsed-\(Int(width))-\(size == .large ? "standard" : "accessible-dark")"
                attachment.lifetime = .keepAlways; add(attachment)
            }
        }
    }

    #if os(macOS)
    @MainActor func testGroupAndIndividualDisclosuresRevealCompleteEvidenceAndSurviveStreamingUpdates() async throws {
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        let document = try fixture(groupOnly: true)
        let model = XgentPresentationModel(); model.update(document)
        let host = NSHostingView(rootView: XgentRootLayout(model: model)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(16).modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light)))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 480, height: 900),
            styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(for: .milliseconds(200))
        func elements() -> [NativeMacAccessibilityElement] { nativeMacAccessibilityTree(window) }
        func press(_ id: String) async throws {
            let element = try XCTUnwrap(elements().first { $0.accessibilityIdentifier() == id && $0.accessibilityRole() == .button })
            XCTAssertTrue(element.accessibilityPerformPress())
            try await Task.sleep(for: .milliseconds(150)); host.layoutSubtreeIfNeeded()
        }
        XCTAssertFalse(elements().contains { $0.accessibilityIdentifier() == "first:disclosure" })
        try await press("group:disclosure")
        XCTAssertTrue(elements().contains { $0.accessibilityIdentifier() == "first:disclosure" })
        XCTAssertTrue(elements().contains { $0.accessibilityIdentifier() == "latest:disclosure" })
        XCTAssertFalse(elements().contains { $0.accessibilityIdentifier() == "xgent-code-block" })
        try await press("first:disclosure")
        for label in ["Arguments", "Failed command output", "Change diff"] {
            XCTAssertTrue(elements().contains { $0.accessibilityText()?.contains(label) == true }, "Expanded evidence retains \(label)")
        }
        model.update(try fixture(revision: 2, groupOnly: true))
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertTrue(elements().contains { $0.accessibilityText()?.contains("git log --oneline --max-count=5") == true },
            "Streaming verification must render the revised document, not a captured fixture")
        XCTAssertTrue(elements().contains { $0.accessibilityIdentifier() == "xgent-code-block" }, "A retained call does not refold on document updates")
        try await press("group:disclosure")
        XCTAssertFalse(elements().contains { $0.accessibilityIdentifier() == "first:disclosure" })
        XCTAssertFalse(elements().contains { $0.accessibilityIdentifier() == "xgent-code-block" })
    }
    #endif

    private func fixture(revision: Int = 1, groupOnly: Bool = false) throws -> XgentDocument {
        func call(_ id: String, _ label: String, _ target: String, _ status: String) -> [String: Any] {
            ["id": id, "kind": "ToolCall", "variant": "timeline", "label": label, "text": target, "status": status,
             "children": [
                ["id": "\(id):args", "kind": "CodeBlock", "label": "Arguments", "language": "json", "text": "{\"path\":\"src/App.tsx\"}"],
                ["id": "\(id):result", "kind": "CodeBlock", "label": "Failed command output", "language": "text", "text": "Detailed output remains available"],
                ["id": "\(id):diff", "kind": "CodeBlock", "label": "Change diff", "language": "diff", "text": "@@ -1 +1 @@\n-before\n+after"]
             ]]
        }
        let payload: [String: Any] = ["version": 1, "surface": "work-evidence", "revision": revision,
            "mode": "root", "title": "Chat", "appearance": "light", "nodes": [
                call("single", "Read", "Inspect the current workspace configuration", "running"),
                ["id": "group", "kind": "ToolCall", "variant": "timeline", "label": "GitHub integration and commands",
                 "text": "2 calls", "status": "error", "children": [
                    call("first", "GitHub · read_file", "src/App.tsx", "error"),
                    call("latest", "Bash", revision == 1 ? "git log --oneline" : "git log --oneline --max-count=5", "completed")
                 ]]
            ]]
        var current = payload
        if groupOnly, let nodes = payload["nodes"] as? [[String: Any]] { current["nodes"] = [nodes[1]] }
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: current))
        try document.validate(); return document
    }
}
