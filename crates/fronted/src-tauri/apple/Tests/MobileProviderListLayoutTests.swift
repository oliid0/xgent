#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileProviderListLayoutTests: XCTestCase {
    @MainActor func testModelSwitchSelectionAndOrderingKeepSeparateTargetsInAdaptiveRows() async throws {
        let rows: [[String: Any]] = [false, true].map { selecting in
            let id = selecting ? "selection" : "enabled"
            return ["id": "row:\(id)", "kind": "VStack", "variant": "provider-model-row", "children": [
                ["id": "model:\(id)", "kind": selecting ? "Button" : "Switch", "variant": "model-selection",
                 "label": "relay/long-model-identifier-上下文", "value": true, "selected": true, "action": "select:\(id)"],
                ["id": "model-limits:\(id)", "kind": "Text", "text": "1000K context · 64K output", "size": "small"],
                ["id": "model-actions:\(id)", "kind": "Menu", "label": "Model settings", "variant": "compact", "children": [
                    ["id": "edit:\(id)", "kind": "Button", "label": "Edit model", "action": "edit:\(id)"]]],
                ["id": "model-reorder:\(id)", "kind": "Menu", "label": "Reorder model", "icon": "line.3.horizontal",
                 "variant": "compact", "children": [["id": "up:\(id)", "kind": "Button", "label": "Move up", "action": "up:\(id)"]]]
            ]]
        }
        let payload: [String: Any] = ["version": 1, "surface": "model-rows", "revision": 1,
            "mode": "sheet", "title": "Models", "appearance": "light", "formFactor": "mobile", "nodes": rows]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        for width in [CGFloat(240), 320, 430, 768] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                for direction in [LayoutDirection.leftToRight, .rightToLeft] {
                    let model = XgentPresentationModel(); model.update(document)
                    let content = ScrollView {
                        VStack(spacing: 12) { XgentIOSNodes(nodes: document.nodes, document: document, model: model) }.padding(12)
                    }.frame(width: width, height: 1600)
                        .dynamicTypeSize(size).environment(\.layoutDirection, direction)
                    let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 1600))
                    window.rootViewController = host; window.makeKeyAndVisible()
                    defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                    host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(200))
                    let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                    let elements = hierarchy.flattenToElements()
                    for suffix in ["enabled", "selection"] {
                        var frames: [CGRect] = []
                        for id in ["model:\(suffix)", "model-reorder:\(suffix)", "model-actions:\(suffix)"] {
                            let matches = elements.filter { $0.identifier == id }
                            XCTAssertEqual(matches.count, 1, "One independent usable control for \(id)")
                            let frame = try XCTUnwrap(matches.first).shape.bezierPath.bounds
                            XCTAssertGreaterThanOrEqual(frame.width, 43.5)
                            XCTAssertGreaterThanOrEqual(frame.height, 43.5)
                            XCTAssertGreaterThanOrEqual(frame.minX, -0.5)
                            XCTAssertLessThanOrEqual(frame.maxX, width + 0.5)
                            XCTAssertLessThanOrEqual(frame.maxY, 1600)
                            for previous in frames { XCTAssertFalse(previous.intersects(frame)) }
                            frames.append(frame)
                        }
                        if width <= 320 || size.isAccessibilitySize {
                            XCTAssertGreaterThanOrEqual(frames[1].minY, frames[0].maxY,
                                "Narrow/accessible layouts put sorting and settings below the model control")
                            XCTAssertGreaterThanOrEqual(frames[2].minY, frames[0].maxY)
                        } else if direction == .leftToRight {
                            XCTAssertLessThanOrEqual(frames[1].maxX, frames[0].minX)
                            XCTAssertLessThanOrEqual(frames[0].maxX, frames[2].minX)
                        } else {
                            XCTAssertGreaterThanOrEqual(frames[1].minX, frames[0].maxX)
                            XCTAssertGreaterThanOrEqual(frames[0].minX, frames[2].maxX)
                        }
                    }
                    let name = "model-rows-\(Int(width))-\(size)-\(direction)"
                    try attachNativeAccessibilityEvidence(hierarchy, name: name)
                    try attachCompositedNativeScreenshot(of: host.view, name: name)
                }
            }
        }
    }

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
                    host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(200))
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
