import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class OtherSettingsRenderingTests: XCTestCase {
    @MainActor func testInlineAreasKeepHeadingsAndActionsReadableAtNarrowWidths() async throws {
        #if os(macOS)
        let accessibility = try NativeMacAccessibilitySession(); defer { accessibility.restore() }
        let formFactor = "desktop"
        #else
        let formFactor = "mobile"
        #endif
        for size in [DynamicTypeSize.large, .accessibility3] {
            for area in ["hooks", "cron", "ssh"] {
                let payload: [String: Any] = ["version": 1, "surface": "settings:other", "revision": 1,
                    "mode": "sheet", "title": "Other", "appearance": "light", "formFactor": formFactor,
                    "nodes": [["id": "other:\(area)", "kind": "VStack", "variant": "other-settings-area",
                        "label": "\(area.uppercased()) · Workspace automation and connections",
                        "children": [
                            ["id": "other:\(area):description", "kind": "Text", "secondary": true,
                             "text": "Manage the saved entries here. Open an editor to change its detailed settings."],
                            ["id": "other:\(area):add", "kind": "Button", "label": "Add a workspace entry", "action": "add"],
                        ]]]]
                let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
                try document.validate()
                let model = XgentPresentationModel(); model.update(document)
                var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
                #if os(iOS)
                let sections = XgentSettingsFormSection.sections(document.nodes)
                XCTAssertEqual(sections.count, 1); XCTAssertEqual(sections[0].id, "other:\(area)")
                let content = XgentIOSSheetPresentation(initialDocument: document, model: model)
                    .frame(width: 320, height: 780).dynamicTypeSize(size)
                let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 780))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(150))
                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                let elements = hierarchy.flattenToElements()
                let heading = try XCTUnwrap(elements.first { $0.identifier == "other:\(area):heading" })
                let button = try XCTUnwrap(elements.first { $0.identifier == "other:\(area):add" && $0.traits.contains(.button) })
                let headingFrame = heading.shape.bezierPath.bounds, buttonFrame = button.shape.bezierPath.bounds
                XCTAssertFalse(headingFrame.intersects(buttonFrame)); XCTAssertGreaterThanOrEqual(buttonFrame.height, 44)
                for frame in [headingFrame, buttonFrame] {
                    XCTAssertGreaterThanOrEqual(frame.minX, 15); XCTAssertLessThanOrEqual(frame.maxX, 305)
                }
                try attachNativeAccessibilityEvidence(hierarchy, name: "other-\(area)-320-\(size)")
                try attachCompositedNativeScreenshot(of: host.view, name: "other-\(area)-320-\(size)")
                #else
                let content = ScrollView {
                    XgentOtherSettingsArea(node: document.nodes[0], document: document, model: model).padding(16)
                }.frame(width: 320, height: 780).dynamicTypeSize(size)
                let host = NSHostingView(rootView: content)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 320, height: 780),
                                      styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                defer { model.invalidate(); window.close() }
                host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(150))
                let elements = nativeMacAccessibilityTree(window)
                let heading = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "other:\(area):heading" })
                let button = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "other:\(area):add" })
                XCTAssertFalse(heading.accessibilityFrame().intersects(button.accessibilityFrame()))
                let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
                for frame in [heading.accessibilityFrame(), button.accessibilityFrame()] {
                    XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX + 15)
                    XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX - 15)
                }
                XCTAssertTrue(button.accessibilityPerformPress()); try await Task.sleep(for: .milliseconds(40))
                XCTAssertEqual(actions.last?.action, "add")
                #endif
            }
        }
    }
}
