#if os(iOS)
import AccessibilitySnapshotParser
import SnapshotTesting
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileComposerLayoutTests: XCTestCase {
    @MainActor func testSupportingChipsLeaveSpaceForTranscriptAndDraft() async throws {
        func wire(_ id: String, _ kind: String, _ fields: [String: Any] = [:]) -> [String: Any] {
            fields.merging(["id": id, "kind": kind]) { _, value in value }
        }
        let children = [
            wire("activity-strip", "HStack", ["children": [
                wire("activity", "Badge", ["label": "Reading workspace", "fill": true]),
            ]]),
            wire("draft", "ComposerInput", ["label": "Message Xgent", "value": "Draft", "action": "draft"]),
            wire("selected-skill", "Button", ["label": "Selected documentation skill", "action": "skill", "fill": true]),
            wire("selected-file", "Button", ["label": "Spreadsheet.xlsx", "action": "file"]),
            wire("composer-actions", "HStack", ["children": [
                wire("attach", "IconButton", ["label": "Attach", "icon": "plus", "action": "attach"]),
                wire("gap", "Spacer"),
                wire("send", "IconButton", ["label": "Send", "icon": "arrow.up", "action": "send"]),
            ]]),
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "chat", "revision": 1, "mode": "root", "title": "Chat",
            "formFactor": "mobile", "nodes": [wire("composer", "Composer", ["children": children])],
        ]))
        try document.validate()
        let model = XgentPresentationModel()
        model.update(document)
        defer { model.invalidate() }
        let composer = try XCTUnwrap(document.nodes.first)
        for width in [CGFloat(320), 768] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let view = VStack(spacing: 0) {
                    Spacer(minLength: 120)
                    XgentIOSComposer(node: composer, document: document, model: model)
                }.frame(width: width, height: 720).dynamicTypeSize(size)
                    .background { XgentThemeBackground() }
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                let host = UIHostingController(rootView: view)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 200_000_000)
                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                try attachNativeAccessibilityEvidence(hierarchy, name: "composer-chips-\(Int(width))-\(size)")
                let elements = hierarchy.flattenToElements()
                for id in ["selected-skill", "attach", "send"] {
                    let element = try XCTUnwrap(elements.first { $0.identifier == id })
                    let bounds = element.shape.bezierPath.bounds
                    XCTAssertGreaterThan(bounds.height, 0)
                    XCTAssertLessThanOrEqual(bounds.maxY, 721, "\(id) must remain reachable")
                    if ["attach", "send"].contains(id) {
                        XCTAssertGreaterThanOrEqual(bounds.minX, -1)
                        XCTAssertLessThanOrEqual(bounds.maxX, width + 1)
                    }
                }
                let skill = try XCTUnwrap(elements.first { $0.identifier == "selected-skill" })
                XCTAssertGreaterThan(skill.shape.bezierPath.bounds.minY, size == .large ? 370 : 120,
                    "Supporting chips must not consume the transcript's height")
                let input = try XCTUnwrap(textView(in: host.view))
                XCTAssertGreaterThan(input.bounds.height, 0)
                let chips = try XCTUnwrap(horizontalScroll(in: host.view))
                XCTAssertLessThan(chips.bounds.height, size == .large ? 110 : 240)
                if chips.contentSize.width > chips.bounds.width {
                    chips.setContentOffset(CGPoint(x: chips.contentSize.width - chips.bounds.width, y: 0), animated: false)
                    host.view.layoutIfNeeded()
                    try await Task.sleep(nanoseconds: 50_000_000)
                }
                let scrolled = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                XCTAssertNotNil(scrolled.flattenToElements().first { $0.identifier == "selected-file" },
                    "Every supporting action remains reachable by horizontal scrolling")
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                let attachment = XCTAttachment(image: image)
                attachment.name = "composer-chips-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    @MainActor private func textView(in view: UIView) -> UITextView? {
        if let input = view as? UITextView { return input }
        return view.subviews.lazy.compactMap { self.textView(in: $0) }.first
    }

    @MainActor private func horizontalScroll(in view: UIView) -> UIScrollView? {
        if let scroll = view as? UIScrollView, !(scroll is UITextView) { return scroll }
        return view.subviews.lazy.compactMap { self.horizontalScroll(in: $0) }.first
    }
}
#endif
