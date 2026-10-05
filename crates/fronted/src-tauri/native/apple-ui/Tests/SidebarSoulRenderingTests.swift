#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class SidebarSoulRenderingTests: XCTestCase {
    @MainActor func testSoulPickerKeepsSelectedPresetAndCreateActionReadableAtLargeText() async throws {
        for size in [DynamicTypeSize.large, .accessibility3] {
            let document = try fixture()
            let model = XgentPresentationModel(); model.update(document)
            let content = XgentSidebarSoulPicker(menu: document.nodes[0], document: document, model: model, close: {})
                .frame(width: 320, height: 720).dynamicTypeSize(size)
            let host = UIHostingController(rootView: content); host.safeAreaRegions = []
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 720))
            window.rootViewController = host; window.makeKeyAndVisible()
            defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(150))
            let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
            let elements = hierarchy.flattenToElements()
            let selected = try XCTUnwrap(elements.first { $0.identifier == "sidebar-soul:0" })
            XCTAssertTrue(selected.traits.contains(.selected))
            var previous: CGRect?
            for id in ["sidebar-soul:0", "sidebar-soul:1", "sidebar-soul-create"] {
                let element = try XCTUnwrap(elements.first { $0.identifier == id })
                let frame = element.shape.bezierPath.bounds
                XCTAssertGreaterThanOrEqual(frame.height, 44)
                XCTAssertGreaterThanOrEqual(frame.minX, -1); XCTAssertLessThanOrEqual(frame.maxX, 321)
                if let previous { XCTAssertFalse(previous.intersects(frame)) }
                previous = frame
            }
            try attachNativeAccessibilityEvidence(hierarchy, name: "sidebar-soul-320-\(size)")
            try attachCompositedNativeScreenshot(of: host.view, name: "sidebar-soul-320-\(size)")
        }
    }

    private func fixture() throws -> XgentDocument {
        let payload: [String: Any] = ["version": 1, "surface": "sidebar", "revision": 1, "mode": "sidebar", "title": "Xgent",
            "appearance": "light", "formFactor": "mobile", "nodes": [["id": "sidebar-soul-menu", "kind": "Menu", "label": "Soul presets", "children": [
                ["id": "sidebar-soul-presets", "kind": "SettingsGroup", "label": "Soul presets", "children": [
                    ["id": "sidebar-soul:0", "kind": "Button", "label": "A selected assistant with a descriptive name", "selected": true, "action": "select0"],
                    ["id": "sidebar-soul:1", "kind": "Button", "label": "Another assistant", "selected": false, "action": "select1"],
                ]],
                ["id": "sidebar-soul-create", "kind": "Button", "label": "Create Soul preset", "icon": "plus", "action": "create"],
            ]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
#endif
