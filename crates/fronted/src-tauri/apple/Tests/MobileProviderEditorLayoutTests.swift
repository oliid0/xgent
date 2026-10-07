#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileProviderEditorLayoutTests: XCTestCase {
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
                XCTAssertGreaterThan(frames[0].minY, 422, "The actions belong below the scrollable form")
                let name = "provider-editor-\(Int(width))-\(size)"
                try attachNativeAccessibilityEvidence(hierarchy, name: name)
                try attachCompositedNativeScreenshot(of: host.view, name: name)
            }
        }
    }
}
#endif
