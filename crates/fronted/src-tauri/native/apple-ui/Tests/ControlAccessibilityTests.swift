#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class ControlAccessibilityTests: XCTestCase {
    @MainActor
    func testRealControlsExposeLabelsDisabledStateAndUsableActivationAreas() async throws {
        let widths: [CGFloat] = [320, 768]
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel()
                model.update(document)
                let view = VStack(alignment: .leading, spacing: 16) {
                    XgentIOSNodes(nodes: document.nodes, document: document, model: model)
                    Spacer(minLength: 0)
                }
                .padding(16)
                .frame(width: width, height: 720, alignment: .topLeading)
                .dynamicTypeSize(size)
                .modifier(XgentPresentationThemeModifier(theme: .fallback,
                    appearance: size == .large ? .light : .dark))
                let host = UIHostingController(rootView: view)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 300_000_000)

                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                let elements = hierarchy.flattenToElements()
                // Preserve the real AX tree even when an assertion fails.
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                let attachment = XCTAttachment(string: String(decoding: try encoder.encode(hierarchy), as: UTF8.self))
                attachment.name = "controls-accessibility-\(Int(width))-\(size == .large ? "standard" : "large-dark")"
                attachment.lifetime = .keepAlways
                add(attachment)
                let install = try XCTUnwrap(elements.first { $0.identifier == "install" && $0.traits.contains(.button) })
                XCTAssertEqual(install.label, "Install Shell environment and software packages")
                let disabled = try XCTUnwrap(elements.first { $0.identifier == "unavailable" && $0.traits.contains(.button) })
                XCTAssertTrue(disabled.traits.contains(.notEnabled))
                let key = try XCTUnwrap(elements.first { $0.identifier == "key" && $0.traits.contains(.secureTextField) })
                XCTAssertEqual(key.label, "API key")
                XCTAssertFalse(key.value?.contains("private-api-value") ?? false,
                    "Secure input must never expose its contents to the accessibility hierarchy")
                let selector = try XCTUnwrap(elements.first { $0.identifier == "auth" && $0.traits.contains(.button) })
                XCTAssertEqual(selector.label, "Authentication method")
                XCTAssertEqual(selector.value, "API key")

                var bounds: [CGRect] = []
                for element in [install, disabled, selector] {
                    guard case let .frame(frame) = element.shape else {
                        XCTFail("Native controls must expose a rectangular activation area")
                        continue
                    }
                    let rect = CGRect(x: CGFloat(frame.minX), y: CGFloat(frame.minY),
                                      width: CGFloat(frame.width), height: CGFloat(frame.height))
                    XCTAssertGreaterThanOrEqual(rect.height, 43.5)
                    XCTAssertGreaterThanOrEqual(rect.minX, -1)
                    XCTAssertLessThanOrEqual(rect.maxX, width + 1)
                    let point = CGPoint(x: CGFloat(element.activationPoint.x), y: CGFloat(element.activationPoint.y))
                    XCTAssertTrue(rect.insetBy(dx: -1, dy: -1).contains(point))
                    for previous in bounds { XCTAssertFalse(previous.intersects(rect), "Independent controls must not overlap") }
                    bounds.append(rect)
                }
            }
        }
    }

    private func fixture() throws -> XgentDocument {
        let nodes: [[String: Any]] = [
            ["id": "install", "kind": "Button", "label": "Install Shell environment and software packages", "action": "install"],
            ["id": "unavailable", "kind": "Button", "label": "Connect unavailable environment", "action": "connect", "disabled": true],
            ["id": "key", "kind": "TextInput", "label": "API key", "secure": true, "value": "private-api-value", "action": "key"],
            ["id": "auth", "kind": "Selector", "label": "Authentication method", "value": "api-key", "action": "auth",
             "options": [["value": "api-key", "label": "API key"], ["value": "oauth", "label": "OAuth"]]],
        ]
        let payload: [String: Any] = ["version": 1, "surface": "accessibility", "title": "Controls",
                                    "appearance": "light", "revision": 1, "mode": "root",
                                    "formFactor": "mobile", "nodes": nodes]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
#endif
