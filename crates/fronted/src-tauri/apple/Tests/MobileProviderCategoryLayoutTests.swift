#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileProviderCategoryLayoutTests: XCTestCase {
    private func fixture(selected: String, appearance: String) throws -> XgentDocument {
        let vendors = [
            ("claude_code", "Anthropic", "xgent.provider.claude_code"), ("codex", "OpenAI", "xgent.provider.codex"),
            ("gemini", "Gemini", "xgent.provider.gemini"), ("xai", "Grok", "xgent.provider.xai"),
            ("deepseek", "DeepSeek", "xgent.provider.deepseek")
        ]
        let payload: [String: Any] = [
            "version": 1, "surface": "settings:providers", "revision": 1, "mode": "sheet",
            "title": "Providers", "appearance": appearance, "formFactor": "mobile",
            "nodes": [
                ["id": "back", "kind": "Button", "label": "Back to settings", "action": "back"],
                ["id": "provider-category-toolbar", "kind": "HStack", "variant": "provider-category-toolbar", "children": [
                    ["id": "provider-vendor", "kind": "Selector", "variant": "provider-vendor-tabs", "label": "Providers",
                     "value": selected, "action": "vendor",
                     "options": vendors.map { ["value": $0.0, "label": $0.1] },
                     "children": vendors.map { ["id": "provider-vendor-state:\($0.0)", "kind": "Text",
                         "value": $0.0, "label": $0.1, "icon": $0.2] }],
                    ["id": "provider-runtime-settings", "kind": "IconButton", "label": "Advanced provider settings",
                     "icon": "slider.horizontal.3", "size": "large", "variant": "ghost", "action": "advanced"]
                ]],
                ["id": "provider-empty", "kind": "EmptyState", "label": "No providers in this category"],
                ["id": "add-provider", "kind": "Button", "label": "Add provider", "action": "add", "size": "large"]
            ]
        ]
        let document = try JSONDecoder().decode(XgentDocument.self,
            from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }

    @MainActor func testSelectedNamedCategoryAndAdvancedActionRemainVisibleAfterNarrowing() async throws {
        for selected in ["claude_code", "deepseek"] {
            for appearance in ["light", "dark"] {
                for size in [DynamicTypeSize.large, .accessibility3] {
                    for direction in [LayoutDirection.leftToRight, .rightToLeft] {
                        let document = try fixture(selected: selected, appearance: appearance)
                        let model = XgentPresentationModel(); model.update(document)
                        let content = XgentIOSSheetPresentation(initialDocument: document, model: model)
                            .dynamicTypeSize(size).environment(\.layoutDirection, direction)
                        let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 768, height: 844))
                        window.rootViewController = host; window.makeKeyAndVisible()
                        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                        for width in [CGFloat(768), 430, 320, 240] {
                            window.frame = CGRect(x: 0, y: 0, width: width, height: 844)
                            host.view.frame = window.bounds
                            host.view.setNeedsLayout(); host.view.layoutIfNeeded()
                            try await Task.sleep(nanoseconds: 250_000_000)
                            let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                            let elements = hierarchy.flattenToElements()
                            let tabs = elements.filter { $0.identifier == "provider-vendor:\(selected)" }
                            XCTAssertEqual(tabs.count, 1, "The selected tab has one actual button identity")
                            let tab = try XCTUnwrap(tabs.first)
                            XCTAssertTrue(tab.traits.contains(.selected))
                            XCTAssertEqual(tab.label, selected == "claude_code" ? "Anthropic" : "DeepSeek")
                            let advanced = elements.filter { $0.identifier == "provider-runtime-settings" }
                            XCTAssertEqual(advanced.count, 1)
                            let frames = [tab.shape.bezierPath.bounds,
                                try XCTUnwrap(advanced.first).shape.bezierPath.bounds]
                            for frame in frames {
                                XCTAssertGreaterThanOrEqual(frame.width, 43.5)
                                XCTAssertGreaterThanOrEqual(frame.height, 43.5)
                                XCTAssertGreaterThanOrEqual(frame.minX, 15.5)
                                XCTAssertLessThanOrEqual(frame.maxX, width - 15.5)
                                XCTAssertGreaterThanOrEqual(frame.minY, 0)
                                XCTAssertLessThanOrEqual(frame.maxY, 844.5)
                            }
                            XCTAssertTrue(frames[0].intersection(frames[1]).isEmpty,
                                "Scrolling categories must reserve the independent advanced action")
                            XCTAssertLessThanOrEqual(frames[0].width, width - 32 - 44 - 8 + 1,
                                "The complete selected label wraps inside the remaining toolbar width")
                            XCTAssertFalse(elements.contains { $0.label == "API" },
                                "Category navigation does not add a form field heading")
                            let name = "provider-categories-\(selected)-\(Int(width))-\(appearance)-\(size)-\(direction)"
                            try attachNativeAccessibilityEvidence(hierarchy, name: name)
                            try attachCompositedNativeScreenshot(of: host.view, name: name)
                        }
                    }
                }
            }
        }
    }
}
#endif
