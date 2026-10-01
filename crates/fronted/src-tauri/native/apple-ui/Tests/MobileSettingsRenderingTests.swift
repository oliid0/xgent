#if os(iOS)
import SnapshotTesting
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileSettingsRenderingTests: XCTestCase {
    func testNestedSettingsKeepEveryActionInOrderWithoutCardsInsideRows() throws {
        let document = try fixture()
        let sections = XgentSettingsFormSection.sections(document.nodes)
        XCTAssertEqual(sections.map(\.labels), [
            ["Provider connection"], ["Shell workspaces"],
            ["Shell workspaces", "Fort Mason"], ["Shell workspaces"], [],
        ])
        XCTAssertEqual(sections.flatMap(\.rows).map(\.id), [
            "provider-name", "provider-key", "provider-auth", "provider-fetch", "workspace-description",
            "workspace-path", "workspace-open", "workspace-refresh", "help",
        ])
        XCTAssertEqual(Set(sections.map(\.id)).count, sections.count)
        XCTAssertFalse(sections.flatMap(\.rows).contains { $0.kind == .settingsGroup })
        let key = try XCTUnwrap(sections.flatMap(\.rows).first { $0.id == "provider-key" })
        XCTAssertEqual(key.action, "provider-key")
        XCTAssertEqual(key.secure, true)
        let auth = try XCTUnwrap(sections.flatMap(\.rows).first { $0.id == "provider-auth" })
        XCTAssertEqual(auth.options?.last?.disabled, true)
    }

    @MainActor
    func testSettingsAtNarrowWideAndAccessibilityDarkSizes() async throws {
        let widths: [CGFloat] = [320, 768]
        for width in widths {
            for typeSize in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel()
                model.update(document)
                let view = XgentIOSSettingsForm(nodes: document.nodes, document: document, model: model)
                    .frame(width: width, height: 720)
                    .background { XgentThemeBackground() }
                    .dynamicTypeSize(typeSize)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback,
                        appearance: typeSize == .large ? .light : .dark))
                let host = UIHostingController(rootView: view)
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 300_000_000)
                XCTAssertEqual(host.view.bounds.width, width, accuracy: 1)
                let scroll = try XCTUnwrap(scrollView(in: host.view))
                if width == 320 && typeSize.isAccessibilitySize {
                    XCTAssertGreaterThan(scroll.contentSize.height, scroll.bounds.height,
                        "Large settings must remain scrollable to reach all fields/actions")
                }
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 2_000)
                let attachment = XCTAttachment(image: image)
                attachment.name = "settings-mobile-manual-\(Int(width))-\(typeSize == .large ? "standard" : "accessibility-dark")"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    @MainActor private func scrollView(in view: UIView) -> UIScrollView? {
        if let scroll = view as? UIScrollView { return scroll }
        for child in view.subviews { if let scroll = scrollView(in: child) { return scroll } }
        return nil
    }

    private func fixture() throws -> XgentDocument {
        func node(_ id: String, _ kind: String, _ fields: [String: Any] = [:]) -> [String: Any] {
            fields.merging(["id": id, "kind": kind]) { _, value in value }
        }
        let nodes = [
            node("provider-details", "SettingsGroup", ["label": "Provider connection", "children": [
                node("provider-name", "TextInput", ["label": "Provider name", "value": "Example provider", "action": "provider-name"]),
                node("provider-key", "TextInput", ["label": "API key", "secure": true, "value": "", "action": "provider-key"]),
                node("provider-auth", "Selector", ["label": "Authentication method", "value": "api-key", "action": "provider-auth", "options": [
                    ["value": "api-key", "label": "API key"], ["value": "oauth-managed", "label": "Managed OAuth", "disabled": true],
                ]]),
                node("provider-fetch", "Button", ["label": "Test the connection and fetch available models", "action": "provider-fetch"]),
            ]]),
            node("shell-workspaces", "SettingsGroup", ["label": "Shell workspaces", "children": [
                node("workspace-description", "Text", ["text": "Mounted directories remain available to the terminal and work tasks."]),
                node("workspace:fort", "SettingsGroup", ["label": "Fort Mason", "children": [
                    node("workspace-path", "Text", ["text": "/workspace/fort-mason", "secondary": true]),
                    node("workspace-open", "Button", ["label": "Open workspace", "action": "workspace-open"]),
                ]]),
                node("workspace-refresh", "Button", ["label": "Refresh mounted workspaces", "action": "workspace-refresh"]),
                node("empty", "SettingsGroup", ["label": "Empty", "children": []]),
            ]]),
            node("help", "Text", ["text": "Use the selected provider for future conversations.", "secondary": true]),
        ]
        let json: [String: Any] = ["version": 1, "surface": "settings-mobile-manual", "revision": 1,
            "mode": "sheet", "title": "Settings", "appearance": "light", "formFactor": "mobile", "nodes": nodes]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }
}
#endif
