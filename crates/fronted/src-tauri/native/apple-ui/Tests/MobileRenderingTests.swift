#if os(iOS)
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileRenderingTests: XCTestCase {
    @MainActor
    func testChatAtNarrowWideAndAccessibleSizes() async throws {
        for (name, width, appearance, typeSize) in [
            ("chat-narrow", CGFloat(320), "light", DynamicTypeSize.large),
            ("chat-dark", CGFloat(390), "dark", DynamicTypeSize.large),
            ("chat-wide", CGFloat(768), "light", DynamicTypeSize.large),
            ("chat-accessible", CGFloat(390), "light", DynamicTypeSize.accessibility2),
        ] {
            let document = try document(mode: "root", appearance: appearance, nodes: chatNodes)
            let model = XgentPresentationModel()
            let view = XgentIOSRootPresentation(document: document, sidebar: nil, model: model)
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: document.appearance))
                .preferredColorScheme(document.colorScheme)
                .dynamicTypeSize(typeSize)
            try await capture(view, name: name, width: width)
        }
    }

    @MainActor
    func testGroupedSettingsAndSidebar() async throws {
        let model = XgentPresentationModel()
        let settings = try document(mode: "sheet", appearance: "dark", nodes: [
            node("general", "SettingsGroup", ["label": "General", "children": [
                node("theme", "Selector", ["label": "Appearance", "value": "dark", "action": "theme", "options": [
                    ["value": "system", "label": "System"], ["value": "dark", "label": "Dark"],
                ]]),
                node("notifications", "Toggle", ["label": "Notifications", "value": true, "action": "notifications"]),
            ]]),
            node("workspace", "SettingsGroup", ["label": "Workspace", "children": [
                node("projects", "NavigationRow", ["label": "Projects", "icon": "folder", "action": "projects"]),
                node("plugins", "NavigationRow", ["label": "Plugins", "icon": "puzzlepiece.extension", "action": "plugins"]),
            ]]),
        ])
        try await capture(XgentIOSSheetPresentation(initialDocument: settings, model: model),
                          name: "settings-dark", width: 390)

        let chat = try document(mode: "root", appearance: "light", nodes: chatNodes)
        let sidebar = try document(mode: "sidebar", appearance: "light", nodes: [
            node("sidebar-layout", "VStack", ["children": [
                node("sidebar-title", "Heading", ["text": "Xgent"]),
                node("sidebar-execution-mode", "Badge", ["label": "Local workspace"]),
                node("sidebar-search-toggle", "IconButton", ["label": "Search", "icon": "magnifyingglass", "action": "search"]),
                node("sidebar-list", "List", ["children": [
                    node("recent", "Heading", ["text": "Recent"]),
                    node("conversation", "NavigationRow", ["label": "Review SwiftUI layout", "action": "open"]),
                ]]),
                node("sidebar-footer", "HStack", ["children": [
                    node("new-chat", "Button", ["label": "New chat", "action": "new"]),
                    node("settings", "IconButton", ["label": "Settings", "icon": "gearshape", "action": "settings"]),
                ]]),
            ]]),
        ])
        try await capture(XgentIOSRootPresentation(document: chat, sidebar: sidebar, model: model),
                          name: "sidebar-narrow", width: 320)
    }

    @MainActor
    private func capture<Content: View>(_ content: Content, name: String, width: CGFloat) async throws {
        let size = CGSize(width: width, height: 844)
        let controller = UIHostingController(rootView: content)
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        window.frame = CGRect(origin: .zero, size: size)
        controller.view.frame = window.bounds
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        defer { window.isHidden = true; window.rootViewController = nil }
        try await Task.sleep(nanoseconds: 500_000_000)
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            XCTAssertTrue(window.drawHierarchy(in: window.bounds, afterScreenUpdates: true))
        }
        XCTAssertEqual(image.size, size)
        XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 10_000)
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func node(_ id: String, _ kind: String, _ properties: [String: Any] = [:]) -> [String: Any] {
        properties.merging(["id": id, "kind": kind]) { _, value in value }
    }

    private func document(mode: String, appearance: String, nodes: [[String: Any]]) throws -> XgentDocument {
        let json: [String: Any] = [
            "version": 1, "surface": "fixture-\(mode)", "revision": 1, "mode": mode,
            "title": "Settings", "appearance": appearance, "formFactor": "mobile",
            "dismissAction": "dismiss", "nodes": nodes,
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }

    private var chatNodes: [[String: Any]] {
        [node("chat", "ChatLayout", ["children": [
            node("toolbar", "HStack", ["children": [
                node("sidebar", "IconButton", ["label": "Open sidebar", "icon": "sidebar.left", "action": "sidebar"]),
                node("execution-mode", "Badge", ["label": "Local workspace"]),
                node("tools", "IconButton", ["label": "Tools", "icon": "ellipsis", "action": "tools"]),
            ]]),
            node("transcript", "ScrollView", ["children": [
                node("answer", "Markdown", ["text": """
                ## Layout review
                - [x] Inspect mobile references
                - [ ] Verify accessible sizes

                | Target | Result |
                | --- | --- |
                | iOS | Native SwiftUI |

                ```swift
                let message = "A long line stays inside a horizontally scrolling code block"
                ```
                """]),
            ]]),
            node("composer", "Composer", ["children": [
                node("activity-strip", "HStack", ["children": [
                    node("read", "Badge", ["label": "Reading workspace", "status": "running"]),
                    node("changes", "Badge", ["label": "Three changed files"]),
                    node("plan", "Badge", ["label": "Reviewing plan"]),
                ]]),
                node("draft", "ComposerInput", ["label": "Message Xgent", "value": "", "action": "draft"]),
                node("composer-actions", "HStack", ["children": [
                    node("model", "Selector", ["label": "Model", "value": "swift", "action": "model", "options": [
                        ["value": "swift", "label": "SwiftUI review model"],
                    ]]),
                    node("context-usage", "ProgressBar", ["label": "Context usage", "current": 12, "total": 100]),
                    node("attach", "IconButton", ["label": "Attach", "icon": "plus", "action": "attach"]),
                    node("send", "IconButton", ["label": "Send", "icon": "arrow.up", "action": "send", "disabled": true]),
                ]]),
            ]]),
        ]])]
    }
}
#endif
