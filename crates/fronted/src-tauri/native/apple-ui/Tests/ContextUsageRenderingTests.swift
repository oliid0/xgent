import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class ContextUsageRenderingTests: XCTestCase {
    @MainActor func testContextDetailsKeepConfirmationReachableAndDispatchTheActualAction() async throws {
        #if os(macOS)
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        #endif
        for size in [DynamicTypeSize.large, .accessibility3] {
            let document = try fixture(disabled: false, revision: 1)
            let node = document.nodes[0]
            let model = XgentPresentationModel()
            model.update(document)
            var actions: [XgentAction] = []
            var closed = 0
            model.actionSink = { actions.append($0) }
            let content = VStack(alignment: .leading, spacing: 12) {
                XgentContextUsage(node: node, document: document, model: model)
                XgentContextUsagePopover(node: node, document: document, model: model) { closed += 1 }
            }.frame(width: 320, height: 640, alignment: .topLeading).dynamicTypeSize(size)
            #if os(iOS)
            let host = UIHostingController(rootView: content)
            host.safeAreaRegions = []
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 640))
            window.rootViewController = host; window.makeKeyAndVisible()
            defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(120))
            func scrolls(_ view: UIView) -> [UIScrollView] {
                (view as? UIScrollView).map { [$0] } ?? view.subviews.flatMap { scrolls($0) }
            }
            for scroll in scrolls(host.view) {
                scroll.setContentOffset(CGPoint(x: 0, y: max(0, scroll.contentSize.height - scroll.bounds.height)), animated: false)
            }
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(60))
            let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
            let elements = hierarchy.flattenToElements()
            var frames: [CGRect] = []
            for id in ["context-usage", "context-cancel", "context-confirm"] {
                let element = try XCTUnwrap(elements.first { $0.identifier == id })
                let frame = element.shape.bezierPath.bounds
                XCTAssertGreaterThanOrEqual(frame.height, 44)
                XCTAssertGreaterThanOrEqual(frame.minX, -1)
                XCTAssertLessThanOrEqual(frame.maxX, 321)
                XCTAssertLessThanOrEqual(frame.maxY, 641)
                XCTAssertFalse(frames.contains { $0.intersects(frame) }, "Context actions must not overlap")
                frames.append(frame)
            }
            try attachNativeAccessibilityEvidence(hierarchy, name: "context-usage-320-\(size)")
            try attachCompositedNativeScreenshot(of: host.view, name: "context-usage-320-\(size)")
            #else
            let host = NSHostingView(rootView: content)
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 320, height: 640),
                                  styleMask: [.titled], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            host.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(160))
            func scrolls(_ view: NSView) -> [NSScrollView] {
                (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap { scrolls($0) }
            }
            for scroll in scrolls(host) {
                guard let content = scroll.documentView else { continue }
                let bottom = max(0, content.bounds.height - scroll.contentView.bounds.height)
                scroll.contentView.scroll(to: NSPoint(x: 0, y: content.isFlipped ? bottom : 0))
                scroll.reflectScrolledClipView(scroll.contentView)
            }
            host.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(60))
            let elements = nativeMacAccessibilityTree(window)
            let cancel = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "context-cancel" })
            let confirm = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "context-confirm" })
            XCTAssertGreaterThanOrEqual(confirm.accessibilityFrame().height, 44)
            XCTAssertLessThanOrEqual(confirm.accessibilityFrame().width, 280)
            XCTAssertFalse(cancel.accessibilityFrame().intersects(confirm.accessibilityFrame()))
            XCTAssertTrue(cancel.accessibilityPerformPress())
            try await Task.sleep(for: .milliseconds(80))
            XCTAssertEqual(closed, 1)
            XCTAssertTrue(actions.isEmpty, "Reading or canceling must not compact")
            XCTAssertTrue(confirm.accessibilityPerformPress())
            try await Task.sleep(for: .milliseconds(80))
            XCTAssertEqual(actions.last?.action, "compact-current-conversation")
            XCTAssertEqual(closed, 2)
            model.update(try fixture(disabled: true, revision: 2))
            try await Task.sleep(for: .milliseconds(100))
            let disabled = try XCTUnwrap(nativeMacAccessibilityTree(window).first {
                $0.accessibilityIdentifier() == "context-confirm"
            })
            XCTAssertFalse(disabled.isAccessibilityEnabled())
            _ = disabled.accessibilityPerformPress()
            XCTAssertEqual(actions.count, 1, "The open details must consume current running-task state")
            let image = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: image)
            let attachment = XCTAttachment(image: NSImage(cgImage: try XCTUnwrap(image.cgImage), size: host.bounds.size))
            attachment.name = "context-usage-320-\(size)"; attachment.lifetime = .keepAlways; add(attachment)
            #endif
        }
    }

    private func fixture(disabled: Bool, revision: Int) throws -> XgentDocument {
        #if os(iOS)
        let formFactor = "mobile"
        #else
        let formFactor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "chat", "revision": revision,
            "mode": "root", "title": "Chat", "appearance": "light", "formFactor": formFactor,
            "nodes": [["id": "context-usage", "kind": "ProgressBar", "variant": "context-usage",
                       "value": "conversation", "label": "Context usage", "current": 50_000, "total": 100_000,
                       "text": "50,000 / 100,000 tokens (50%)", "children": [
                ["id": "context-description", "kind": "Text", "text": "Summarize the conversation to leave space for more work."],
                ["id": "context-cancel", "kind": "Button", "label": "Cancel"],
                ["id": "context-confirm", "kind": "Button", "label": "Compact conversation",
                 "action": "compact-current-conversation", "disabled": disabled],
            ]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
