#if os(macOS)
import AppKit
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class DesktopSettingsRenderingTests: XCTestCase {
    @MainActor
    func testHandwrittenSettingsFitNarrowWideAndAccessibilityWindows() async throws {
        let widths: [CGFloat] = [640, 1040]
        for width in widths {
            for typeSize in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel()
                model.update(document)
                let view = XgentDesktopSettingsLayout(node: document.nodes[0], document: document, model: model)
                    .frame(width: width, height: 720)
                    .background { XgentThemeBackground() }
                    .dynamicTypeSize(typeSize)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback,
                        appearance: typeSize == .large ? .light : .dark))
                let host = NSHostingView(rootView: view)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 720),
                                      styleMask: [.titled], backing: .buffered, defer: false)
                window.contentView = host
                window.orderFront(nil)
                defer { window.orderOut(nil); window.contentView = nil }
                host.layoutSubtreeIfNeeded()
                try await Task.sleep(nanoseconds: 100_000_000)
                XCTAssertEqual(host.bounds.width, width, accuracy: 1,
                    "Settings must fit the actual window instead of forcing a 900-point minimum")
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 2_000)
                let attachment = XCTAttachment(image: image)
                attachment.name = "settings-manual-\(Int(width))-\(typeSize == .large ? "standard" : "accessibility-dark")"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    @MainActor
    func testNavigationSearchAndProviderFieldsKeepTheirLiveBusinessActions() throws {
        let document = try fixture()
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        model.update(document)
        for (id, value) in [
            ("settings-search", XgentValue.string("Provider")),
            ("desktop-nav:providers", .null),
            ("provider-key", .string("updated-key")),
            ("provider-model", .string("alternative")),
            ("settings-close", .null),
        ] {
            let node = try XCTUnwrap(document.node(id: id))
            model.send(node, in: document, value: value, editing: value != .null)
            XCTAssertEqual(actions.last?.action, node.action)
            XCTAssertEqual(actions.last?.value, value)
        }
        model.invalidate()
        let count = actions.count
        model.send(try XCTUnwrap(document.node(id: "provider-key")), in: document,
                   value: .string("retired-key"), editing: true)
        XCTAssertEqual(actions.count, count)
    }

    private func fixture() throws -> XgentDocument {
        func node(_ id: String, _ kind: String, _ fields: [String: Any] = [:]) -> [String: Any] {
            var value = fields
            value["id"] = id
            value["kind"] = kind
            return value
        }
        let json: [String: Any] = [
            "version": 1, "surface": "settings-manual", "revision": 1, "mode": "sheet",
            "title": "Settings", "appearance": "light", "formFactor": "desktop", "nodes": [
                node("settings-layout", "SettingsLayout", ["fill": true, "children": [
                    node("settings-sidebar", "VStack", ["children": [
                        node("settings-search", "TextInput", ["label": "Search settings", "value": "", "action": "search"]),
                        node("settings-navigation", "List", ["children": [
                            node("desktop-nav:general", "NavigationRow", ["label": "General", "icon": "gearshape", "action": "general"]),
                            node("desktop-nav:providers", "NavigationRow", ["label": "Providers", "icon": "network", "selected": true, "action": "providers"]),
                            node("desktop-nav:backup", "NavigationRow", ["label": "Backup and synchronization", "icon": "icloud", "action": "backup"]),
                        ]]),
                        node("settings-close", "Button", ["label": "Back to Chat", "action": "close"]),
                    ]]),
                    node("settings-detail", "ScrollView", ["children": [
                        node("settings-detail-title", "Heading", ["text": "Providers"]),
                        node("provider-settings", "SettingsGroup", ["label": "Connection", "children": [
                            node("provider-name", "TextInput", ["label": "Provider name", "value": "Example provider", "action": "name"]),
                            node("provider-key", "TextInput", ["label": "API key", "value": "", "secure": true, "action": "key"]),
                            node("provider-model", "Selector", ["label": "Default model", "value": "current", "action": "model", "options": [
                                ["value": "current", "label": "Current model"],
                                ["value": "alternative", "label": "Alternative model with a longer display name"],
                            ]]),
                            node("provider-test", "Button", ["label": "Test connection and fetch available models", "action": "test", "prominent": true]),
                        ]]),
                    ]]),
                ]]),
            ],
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }
}
#endif
