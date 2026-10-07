#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileProviderListLayoutTests: XCTestCase {
    @MainActor func testProviderDetailsAndSeparateActionsFitNarrowAndLargeTextLayouts() async throws {
        let payload: [String: Any] = [
            "version": 1, "surface": "settings:providers", "revision": 1,
            "mode": "sheet", "title": "Providers", "appearance": "light", "formFactor": "mobile",
            "nodes": [["id": "provider-list", "kind": "ProviderList", "value": "[\"a\"]", "action": "reorder",
                "children": [["id": "provider-list-row:a", "kind": "VStack", "value": "a", "children": [
                    ["id": "provider:a", "kind": "NavigationRow", "label": "A provider with a long multilingual name 用户供应商",
                     "text": "https://example.test/long-provider-endpoint/long-provider-endpoint/ · 3 active models", "icon": "xgent.provider.claude_code", "action": "edit"],
                    ["id": "provider-list-actions:a", "kind": "Menu", "variant": "compact", "label": "Reorder provider", "icon": "line.3.horizontal", "disabled": true,
                     "children": [["id": "provider-up:a", "kind": "Button", "label": "Move up", "action": "up", "disabled": true]]],
                    ["id": "provider-more:a", "kind": "Menu", "label": "More provider actions", "icon": "ellipsis", "variant": "compact", "size": "large", "children": [
                        ["id": "provider-usage-refresh:a", "kind": "IconButton", "label": "Refresh usage", "icon": "arrow.clockwise", "action": "refresh"],
                        ["id": "provider-edit:a", "kind": "IconButton", "label": "Edit provider", "icon": "pencil", "action": "edit"],
                        ["id": "provider-list-delete:a", "kind": "IconButton", "label": "Delete provider", "icon": "trash", "action": "delete", "destructive": true]
                    ]],
                    ["id": "provider-list-usage:a", "kind": "Text", "text": "Quota diagnostic https://example.test/long-diagnostic-path/long-diagnostic-path/", "secondary": true],
                    ["id": "provider-list-proxy:a", "kind": "Badge", "label": "Use system proxy", "icon": "arrow.triangle.branch"]
                ]]]]]
        ]
        let document = try JSONDecoder().decode(XgentDocument.self,
            from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        let list = try XCTUnwrap(document.nodes.first)
        for width in [CGFloat(240), 320, 430, 768] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                for direction in [LayoutDirection.leftToRight, .rightToLeft] {
                    let model = XgentPresentationModel(); model.update(document)
                    let content = VStack(alignment: .leading, spacing: 0) {
                        XgentProviderListView(node: list, document: document, model: model)
                        Spacer(minLength: 0)
                    }
                    .frame(width: width, height: 1600)
                    .dynamicTypeSize(size).environment(\.layoutDirection, direction)
                    let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 1600))
                    window.rootViewController = host; window.makeKeyAndVisible()
                    defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                    host.view.layoutIfNeeded(); try await Task.sleep(nanoseconds: 200_000_000)
                    let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                    let elements = hierarchy.flattenToElements()
                    let identifiers = ["provider:a", "provider-list-actions:a", "provider-more:a"]
                    var frames: [CGRect] = []
                    for id in identifiers {
                        let identified = elements.filter { $0.identifier == id }
                        XCTAssertEqual(identified.count, 1, "One actual control per action: \(id)")
                        let bounds = try XCTUnwrap(identified.first).shape.bezierPath.bounds
                        XCTAssertGreaterThanOrEqual(bounds.width, 43.5)
                        XCTAssertGreaterThanOrEqual(bounds.height, 43.5)
                        XCTAssertGreaterThanOrEqual(bounds.minX, -0.5)
                        XCTAssertLessThanOrEqual(bounds.maxX, width + 0.5)
                        XCTAssertLessThanOrEqual(bounds.maxY, 1600)
                        frames.append(bounds)
                    }
                    for first in frames.indices {
                        for second in frames.indices where second > first {
                            XCTAssertTrue(frames[first].intersection(frames[second]).isEmpty,
                                "Provider text and independent actions must not overlap")
                        }
                    }
                    if direction == .leftToRight {
                        XCTAssertLessThanOrEqual(frames[1].maxX, frames[0].minX,
                            "Ordering remains at the leading edge at every width")
                        XCTAssertGreaterThanOrEqual(frames[2].minX, frames[0].maxX)
                    } else {
                        XCTAssertGreaterThanOrEqual(frames[1].minX, frames[0].maxX)
                        XCTAssertLessThanOrEqual(frames[2].maxX, frames[0].minX)
                    }
                    let name = "providers-\(Int(width))-\(size)-\(direction)"
                    try attachNativeAccessibilityEvidence(hierarchy, name: name)
                    try attachCompositedNativeScreenshot(of: host.view, name: name)
                }
            }
        }
    }
}
#endif
