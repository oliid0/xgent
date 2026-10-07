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
    #if os(iOS)
    @MainActor func testStackedModelSelectorKeepsTheFullSelectedNameAndWidthInsideASettingsRow() async throws {
        let selectedName = "A selected multilingual model with a very long provider and model name 用户模型"
        for width in [CGFloat(240), CGFloat(320), CGFloat(390)] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let payload: [String: Any] = ["version": 1, "surface": "memory-model", "revision": 1,
                    "mode": "root", "title": "Memory settings", "appearance": "light", "formFactor": "mobile",
                    "nodes": [["id": "memory-organizer-model", "kind": "Selector",
                        "variant": "searchable-stacked-selector", "label": "Memory organization", "icon": "cpu",
                        "value": "provider::model", "action": "select",
                        "options": [["value": "", "label": "Not selected"], ["value": "provider::model", "label": selectedName]]]]]
                let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
                try document.validate()
                let model = XgentPresentationModel()
                model.update(document)
                let selectedNode = try XCTUnwrap(document.nodes.first)
                let view = ScrollView {
                    XgentSelector(node: selectedNode, document: document, model: model)
                        .environment(\.xgentSettingsRow, true)
                        .padding(.horizontal, 32)
                }
                    .dynamicTypeSize(size)
                    .frame(width: width, height: 844, alignment: .topLeading)
                let host = UIHostingController(rootView: view)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(for: .milliseconds(200))
                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: window)
                let selection = try XCTUnwrap(hierarchy.flattenToElements().first {
                    $0.identifier == "memory-organizer-model" && $0.traits.contains(.button)
                })
                XCTAssertEqual(selection.value, selectedName)
                let bounds = selection.shape.bezierPath.bounds
                XCTAssertGreaterThanOrEqual(bounds.width, width - 66,
                    "The picker belongs below the label and uses the full card width")
                XCTAssertGreaterThanOrEqual(bounds.height, 44)
                XCTAssertGreaterThanOrEqual(bounds.minX, 31)
                XCTAssertLessThanOrEqual(bounds.maxX, width - 31)
                let name = "memory-stacked-model-\(Int(width))-\(size)"
                try attachNativeAccessibilityEvidence(hierarchy, name: name)
                try attachCompositedNativeScreenshot(of: window, name: name)
            }
        }
    }
    #endif

    @MainActor func testSearchableFontPickerFitsNarrowWideAndAccessibleLayouts() async throws {
        #if os(macOS)
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        #endif
        for width in [CGFloat(320), CGFloat(768)] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture(), model = XgentPresentationModel()
                var actions: [XgentAction] = []
                model.actionSink = { actions.append($0) }
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
                // AppKit's native List creates its rows after joining a window.
                // A detached hosting view can produce an empty but correctly sized image.
                let host = NSHostingView(rootView: view.environment(\.accessibilityEnabled, true))
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 720),
                                      styleMask: [.borderless], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host
                window.makeKeyAndOrderFront(nil)
                defer { model.invalidate(); window.close() }
                try await Task.sleep(for: .milliseconds(200))
                host.layoutSubtreeIfNeeded()
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let elements = nativeMacAccessibilityTree(host)
                try attachNativeAccessibilityEvidence(elements.map {
                    ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityText() ?? ""]
                }, name: "font-picker-AX-\(Int(width))-\(size)")
                let field = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "font:search" })
                let first = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "font:option:default" })
                let choice = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "font:option:font-1" })
                let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
                for element in [field, first, choice] {
                    let frame = element.accessibilityFrame()
                    XCTAssertGreaterThan(frame.width, 0)
                    XCTAssertGreaterThan(frame.height, 0)
                    XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1)
                    XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
                    XCTAssertGreaterThanOrEqual(frame.minY, bounds.minY - 1)
                    XCTAssertLessThanOrEqual(frame.maxY, bounds.maxY + 1)
                }
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                let shot = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                #endif
                let attachment = XCTAttachment(image: shot)
                attachment.name = "font-picker-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
                #if os(macOS)
                XCTAssertTrue(choice.isAccessibilityEnabled())
                XCTAssertTrue(choice.accessibilityPerformPress())
                try await Task.sleep(for: .milliseconds(100))
                XCTAssertEqual(actions.last?.action, "select")
                XCTAssertEqual(actions.last?.value, .string("font-1"))
                #endif
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
