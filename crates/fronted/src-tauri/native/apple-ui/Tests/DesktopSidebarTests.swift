#if os(macOS)
import AppKit
import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class DesktopSidebarTests: XCTestCase {
    @MainActor func testDesktopNavigationOrderBoundsAndActualButtonActions() async throws {
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        for width in [CGFloat(280), 480] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel()
                var actions: [XgentAction] = []
                model.actionSink = { actions.append($0) }
                model.update(document)
                let host = NSHostingView(rootView: XgentDesktopSidebar(document: document, model: model)
                    .environment(\.accessibilityEnabled, true)
                    .dynamicTypeSize(size)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light)))
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 760),
                                      styleMask: [.borderless], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host
                window.makeKeyAndOrderFront(nil)
                defer { model.invalidate(); window.close() }
                try await Task.sleep(nanoseconds: 200_000_000)
                host.layoutSubtreeIfNeeded()
                let elements = accessibilityElements(host)
                try attachNativeAccessibilityEvidence(elements.map { ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityLabel() ?? ""] },
                    name: "sidebar-accessibility-\(Int(width))-\(size)")
                let newChat = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "new-chat" })
                let skills = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "skills" })
                let settings = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "settings" })
                let mode = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "sidebar-execution-mode" })
                let soul = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "sidebar-soul-menu" })
                let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
                for element in [newChat, skills, settings, mode, soul] {
                    let frame = element.accessibilityFrame()
                    XCTAssertGreaterThan(frame.height, 20)
                    XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1)
                    XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
                    XCTAssertGreaterThanOrEqual(frame.minY, bounds.minY - 1)
                    XCTAssertLessThanOrEqual(frame.maxY, bounds.maxY + 1)
                }
                // AppKit screen coordinates increase upwards.
                XCTAssertGreaterThanOrEqual(newChat.accessibilityFrame().minY, skills.accessibilityFrame().maxY - 1)
                XCTAssertGreaterThan(skills.accessibilityFrame().minY, settings.accessibilityFrame().maxY)
                XCTAssertTrue(newChat.accessibilityPerformPress())
                try await Task.sleep(nanoseconds: 100_000_000)
                XCTAssertEqual(actions.last?.action, "new-chat")
                let search = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "sidebar-search-toggle" })
                XCTAssertTrue(search.accessibilityPerformPress())
                try await Task.sleep(nanoseconds: 100_000_000)
                XCTAssertEqual(actions.last?.action, "workspace-search")
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 760))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                let attachment = XCTAttachment(image: image)
                attachment.name = "desktop-sidebar-\(Int(width))-\(size == .large ? "standard" : "accessible")"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    @MainActor private func accessibilityElements(_ root: Any) -> [NativeMacAccessibilityElement] {
        nativeMacAccessibilityTree(root)
    }

    private func fixture() throws -> XgentDocument {
        let payload: [String: Any] = ["version": 1, "surface": "sidebar", "revision": 1,
            "mode": "sidebar", "title": "XGent", "appearance": "light", "formFactor": "desktop",
            "dismissAction": "close", "nodes": [["id": "sidebar-layout", "kind": "VStack", "children": [
                ["id": "sidebar-title", "kind": "Heading", "text": "XGent"],
                ["id": "sidebar-execution-mode", "kind": "Selector", "variant": "sidebar-work-mode",
                    "label": "Work mode", "value": "tools", "action": "work-mode",
                    "options": [["value": "tools", "label": "Xgent"], ["value": "text", "label": "Xchat"]]],
                ["id": "sidebar-close", "kind": "IconButton", "label": "Close sidebar", "action": "close"],
                ["id": "sidebar-search-toggle", "kind": "IconButton", "label": "Search workspace", "icon": "magnifyingglass", "action": "workspace-search"],
                ["id": "sidebar-list", "kind": "List", "children": [
                    ["id": "skills", "kind": "NavigationRow", "label": "Skills", "icon": "link", "action": "skills"],
                    ["id": "mcp", "kind": "NavigationRow", "label": "MCP", "action": "mcp"],
                    ["id": "files", "kind": "NavigationRow", "label": "My files", "action": "files"],
                    ["id": "create-project", "kind": "NavigationRow", "label": "Create workspace", "action": "create-project"],
                    ["id": "projects-label", "kind": "Heading", "text": "Workspaces"],
                    ["id": "recents-label", "kind": "Heading", "text": "Recent conversations"],
                ]],
                ["id": "sidebar-footer", "kind": "HStack", "children": [
                    ["id": "new-chat", "kind": "Button", "label": "New conversation", "icon": "square.and.pencil", "action": "new-chat"],
                    ["id": "sidebar-soul-menu", "kind": "Menu", "variant": "ghost", "icon": "sparkles",
                     "label": "An assistant preset with a long descriptive name", "children": [
                        ["id": "sidebar-soul:selected", "kind": "Button", "label": "Selected preset", "selected": true, "action": "select-soul"],
                     ]],
                    ["id": "settings", "kind": "IconButton", "label": "Settings", "icon": "gearshape", "action": "settings"],
                ]],
            ]]]]
        let document = try JSONDecoder().decode(XgentDocument.self,
            from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
#endif
