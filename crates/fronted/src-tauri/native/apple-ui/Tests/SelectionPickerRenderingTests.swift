import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
import AccessibilitySnapshotParser
#else
import AppKit
#endif
@testable import XgentNativeUI

final class SelectionPickerRenderingTests: XCTestCase {
    @MainActor func testSearchableFontPickerFitsNarrowWideAndAccessibleLayouts() async throws {
        for width in [CGFloat(320), CGFloat(768)] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture(), model = XgentPresentationModel()
                model.update(document)
                let view = XgentSelectionPicker(node: try XCTUnwrap(document.nodes.first), document: document,
                    model: model, isPresented: .constant(true))
                    .dynamicTypeSize(size).frame(width: width, height: 720)
                #if os(iOS)
                let host = UIHostingController(rootView: view)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil; model.invalidate() }
                host.view.layoutIfNeeded()
                try await Task.sleep(for: .milliseconds(200))
                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                let elements = hierarchy.flattenToElements()
                let field = try XCTUnwrap(elements.first { $0.identifier == "font:search" })
                XCTAssertEqual(field.label, "Search fonts")
                let first = try XCTUnwrap(elements.first { $0.identifier == "font:option:default" })
                XCTAssertTrue(first.traits.contains(.selected))
                for element in [field, first] {
                    let bounds = element.shape.bezierPath.bounds
                    XCTAssertGreaterThanOrEqual(bounds.minX, -1)
                    XCTAssertLessThanOrEqual(bounds.maxX, width + 1)
                }
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                let shot = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                #else
                let host = NSHostingView(rootView: view)
                host.frame = CGRect(x: 0, y: 0, width: width, height: 720); host.layoutSubtreeIfNeeded()
                try await Task.sleep(for: .milliseconds(200))
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                let shot = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                defer { model.invalidate() }
                #endif
                let attachment = XCTAttachment(image: shot)
                attachment.name = "font-picker-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    private func fixture() throws -> XgentDocument {
        let options = [["value": "default", "label": "System default"]] +
            (1...30).map { ["value": "font-\($0)", "label": "Font family \($0) — 中文字体"] }
        let payload: [String: Any] = ["version": 1, "surface": "fonts", "revision": 1, "mode": "root",
            "title": "Fonts", "appearance": "light", "nodes": [[
                "id": "font", "kind": "Selector", "variant": "searchable-selector", "label": "Interface font family",
                "value": "default", "action": "select", "options": options, "children": [
                    ["id": "search-label", "kind": "Text", "label": "Search fonts"],
                    ["id": "empty", "kind": "EmptyState", "label": "No matching fonts"],
                    ["id": "close", "kind": "Text", "label": "Cancel"]]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
