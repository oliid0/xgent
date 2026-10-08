#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileProviderEditorLayoutTests: XCTestCase {
    @MainActor func testCompactModelAndMCPSheetsOwnTheirHeaderAndKeepLongFooterActionsVisible() async throws {
        for variant in ["provider-model-settings", "mcp-registry-preview"] {
            let fields: [[String: Any]] = (0..<20).map { index in
                ["id": "detail-field-\(index)", "kind": "TextInput", "label": "Model configuration parameter \(index)",
                 "value": "Editable setting", "action": "edit-\(index)"]
            }
            let payload: [String: Any] = [
                "version": 1, "surface": "detail:\(variant)", "revision": 1, "mode": "sheet",
                "title": "Model details", "appearance": "light", "formFactor": "mobile", "dismissAction": "close",
                "nodes": [["id": "detail", "kind": "VStack", "variant": variant, "fill": true, "children": [
                    ["id": "detail-close", "kind": "IconButton", "label": "Close model details", "icon": "xmark", "action": "close"],
                    ["id": "detail-title", "kind": "Heading", "text": "Model alias 用户自定义模型"],
                    ["id": "detail-body", "kind": "VStack", "variant": "extension-preview-body", "children": fields],
                    ["id": "detail-footer", "kind": "HStack", "variant": "extension-preview-footer", "children": [
                        ["id": "detail-delete", "kind": "Button", "label": "Delete model configuration", "action": "delete", "destructive": true],
                        ["id": "detail-cancel", "kind": "Button", "label": "Cancel unsaved changes", "action": "cancel"],
                        ["id": "detail-save", "kind": "Button", "label": "Save model configuration", "action": "save", "prominent": true]
                    ]]
                ]]]
            ]
            let document = try JSONDecoder().decode(XgentDocument.self,
                from: JSONSerialization.data(withJSONObject: payload))
            try document.validate()
            for width in [CGFloat(240), 320, 430] {
                for size in [DynamicTypeSize.large, .accessibility3] {
                    let model = XgentPresentationModel(); model.update(document)
                    let content = XgentIOSSheetPresentation(initialDocument: document, model: model)
                        .frame(width: width, height: 844).dynamicTypeSize(size)
                    let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
                    window.rootViewController = host; window.makeKeyAndVisible()
                    defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                    host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(200))
                    let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                    let elements = hierarchy.flattenToElements()
                    XCTAssertFalse(elements.contains { $0.identifier == "presentation-sheet-title" || $0.identifier == "presentation-sheet-close" },
                        "The detail shell owns the only title and close control")
                    let close = try XCTUnwrap(elements.first { $0.identifier == "detail-close" }).shape.bezierPath.bounds
                    var frames: [CGRect] = []
                    for id in ["detail-delete", "detail-cancel", "detail-save"] {
                        let actions = elements.filter { $0.identifier == id && $0.traits.contains(.button) }
                        XCTAssertEqual(actions.count, 1, "One real action outside the scrolling body")
                        let frame = try XCTUnwrap(actions.first).shape.bezierPath.bounds
                        XCTAssertGreaterThanOrEqual(frame.width, 43.5)
                        XCTAssertGreaterThanOrEqual(frame.height, 43.5)
                        XCTAssertGreaterThanOrEqual(frame.minX, -0.5)
                        XCTAssertLessThanOrEqual(frame.maxX, width + 0.5)
                        XCTAssertLessThanOrEqual(frame.maxY, 844.5)
                        XCTAssertFalse(frame.intersects(close))
                        let actionNode = try XCTUnwrap(document.node(id: id))
                        // AX bounds alone miss text drawing outside a shorter
                        // button background. Measure the same native font at
                        // the action's actual available text width.
                        let label = UIHostingController(rootView: Text(actionNode.label ?? "")
                            .modifier(XgentControlTypography(node: actionNode))
                            .fontWeight(.medium)
                            .fixedSize(horizontal: false, vertical: true)
                            .dynamicTypeSize(size))
                        label.safeAreaRegions = []
                        let textSize = label.sizeThatFits(in: CGSize(
                            width: max(1, frame.width - 2 * CGFloat(XgentPresentationTheme.fallback.spacing.md)),
                            height: .greatestFiniteMagnitude))
                        XCTAssertGreaterThanOrEqual(frame.height + 1, textSize.height +
                            2 * CGFloat(XgentPresentationTheme.fallback.spacing.xs),
                            "The complete wrapped label must fit inside its real button background")
                        frames.append(frame)
                    }
                    for first in frames.indices {
                        for second in frames.indices where second > first {
                            XCTAssertTrue(frames[first].intersection(frames[second]).isEmpty)
                        }
                    }
                    let name = "\(variant)-\(Int(width))-\(size)"
                    try attachNativeAccessibilityEvidence(hierarchy, name: name)
                    try attachCompositedNativeScreenshot(of: host.view, name: name)
                }
            }
        }
    }

    @MainActor func testLongEditorKeepsTwoCompleteFooterActionsInsideViewport() async throws {
        let fields: [[String: Any]] = (0..<24).map { index in
            ["id": "field-\(index)", "kind": "TextInput", "label": "A provider setting with a long label \(index)",
             "value": "Editable setting", "action": "edit-\(index)"]
        }
        let payload: [String: Any] = [
            "version": 1, "surface": "settings:provider-editor", "revision": 1,
            "mode": "sheet", "title": "Edit Provider", "appearance": "light", "formFactor": "mobile",
            "nodes": [
                ["id": "back", "kind": "Button", "label": "Back", "action": "back"],
                ["id": "provider-details", "kind": "SettingsGroup", "label": "Provider configuration", "children": fields],
                ["id": "provider-editor-actions", "kind": "HStack", "variant": "provider-editor-actions", "spacing": 8,
                 "children": [
                    ["id": "provider-editor-cancel", "kind": "Button", "label": "Cancel unsaved changes", "action": "cancel",
                     "size": "large", "fill": true, "variant": "secondary"],
                    ["id": "provider-editor-save", "kind": "Button", "label": "Save provider configuration", "action": "save",
                     "size": "large", "fill": true, "variant": "primary"]
                 ]]
            ]
        ]
        let document = try JSONDecoder().decode(XgentDocument.self,
            from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        for width in [CGFloat(240), 320, 430, 768] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let model = XgentPresentationModel(); model.update(document)
                let content = XgentIOSSheetPresentation(initialDocument: document, model: model)
                    .frame(width: width, height: 844).dynamicTypeSize(size)
                let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(200))
                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                let elements = hierarchy.flattenToElements()
                var frames: [CGRect] = []
                for id in ["provider-editor-cancel", "provider-editor-save"] {
                    let controls = elements.filter { $0.identifier == id }
                    XCTAssertEqual(controls.count, 1, "The fixed footer must not duplicate its action in the form")
                    let frame = try XCTUnwrap(controls.first).shape.bezierPath.bounds
                    XCTAssertGreaterThanOrEqual(frame.width, 43.5)
                    XCTAssertGreaterThanOrEqual(frame.height, 43.5)
                    XCTAssertGreaterThanOrEqual(frame.minX, -0.5)
                    XCTAssertLessThanOrEqual(frame.maxX, width + 0.5)
                    XCTAssertGreaterThanOrEqual(frame.minY, 0)
                    XCTAssertLessThanOrEqual(frame.maxY, 844.5,
                        "Save and Cancel must remain in the actual viewport despite the long form")
                    frames.append(frame)
                }
                XCTAssertTrue(frames[0].intersection(frames[1]).isEmpty)
                XCTAssertEqual(frames[0].width, frames[1].width, accuracy: 1)
                if size.isAccessibilitySize {
                    XCTAssertGreaterThanOrEqual(frames[0].width, width - 33,
                        "Large text needs complete action names across the available row")
                    XCTAssertGreaterThanOrEqual(frames[1].minY, frames[0].maxY + 7,
                        "Long scaled actions must stack instead of fragmenting into narrow columns")
                }
                XCTAssertGreaterThan(frames[0].minY, 422, "The actions belong below the scrollable form")
                let name = "provider-editor-\(Int(width))-\(size)"
                try attachNativeAccessibilityEvidence(hierarchy, name: name)
                try attachCompositedNativeScreenshot(of: host.view, name: name)
            }
        }
    }
}
#endif
