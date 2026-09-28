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
                node("notifications", "Switch", ["label": "Notifications", "value": true, "action": "notifications"]),
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
    func testModelGroupsAndLongSettingsHeader() async throws {
        let model = XgentPresentationModel()
        let chat = try document(mode: "root", appearance: "dark", nodes: chatNodes)
        let composer = try XCTUnwrap(chat.nodes.first?.children?.first { $0.id == "composer" })
        let actions = try XCTUnwrap(composer.children?.first { $0.id == "composer-actions" })
        let modelNode = try XCTUnwrap(actions.children?.first { $0.id == "model" })
        try await capture(XgentIOSModelPicker(node: modelNode, document: chat, model: model),
                          name: "model-groups-narrow", width: 320)
        let settings = try document(mode: "sheet", appearance: "light", nodes: [
            node("back", "Button", ["label": "Back", "action": "back"]),
            node("save-status", "Text", ["text": "Saving changes", "secondary": true]),
            node("general", "SettingsGroup", ["label": "General", "children": [
                node("language", "Selector", ["label": "App language", "icon": "globe", "value": "en", "action": "language", "options": [
                    ["value": "en", "label": "English"], ["value": "zh", "label": "Chinese"],
                ]]),
                node("memory", "Switch", ["label": "Enable memory", "icon": "brain", "value": true, "action": "memory"]),
            ]]),
        ], title: "Workspace and memory settings")
        try await capture(XgentIOSSheetPresentation(initialDocument: settings, model: model)
            .dynamicTypeSize(.accessibility2), name: "settings-header-accessible", width: 320)
    }

    @MainActor
    func testProjectPluginPermissionAndMemorySurfaces() async throws {
        let model = XgentPresentationModel()
        let project = try document(mode: "sheet", appearance: "light", nodes: [
            node("project-hint", "Text", ["text": "Create a project folder or clone a repository into your workspace.", "secondary": true]),
            node("project-mode", "SegmentedControl", ["label": "Project", "value": "clone", "action": "project-mode", "options": [
                ["value": "new", "label": "New project"], ["value": "clone", "label": "Clone repository"],
            ]]),
            node("clone", "SettingsGroup", ["label": "Repository", "children": [
                node("remote-url", "TextInput", ["label": "Repository URL", "value": "https://github.com/owner/project.git", "action": "remote-url"]),
                node("branch", "TextInput", ["label": "Branch", "value": "main", "action": "branch"]),
                node("load-branches", "Button", ["label": "Load branches", "action": "load-branches"]),
            ]]),
            node("project", "SettingsGroup", ["label": "New project", "children": [
                node("name", "TextInput", ["label": "Name", "value": "project", "action": "name"]),
                node("destination", "Text", ["text": "/workspace/projects", "secondary": true]),
                node("create", "Button", ["label": "Clone repository", "action": "create"]),
                node("choose-destination", "Button", ["label": "Choose destination", "action": "choose-destination"]),
            ]]),
        ], title: "Clone repository")
        try await capture(XgentIOSSheetPresentation(initialDocument: project, model: model),
                          name: "project-clone-narrow", width: 320)

        let plugins = try document(mode: "root", appearance: "light", nodes: [
            node("skills-hub-layout", "VStack", ["fill": true, "children": [
                node("skills-hub-toolbar", "HStack", ["minHeight": 68, "padding": 12, "children": [
                    node("open-sidebar", "IconButton", ["label": "Open sidebar", "icon": "xgent.sidebar", "action": "open-sidebar"]),
                    node("skills-hub-title", "Heading", ["text": "Plugins", "fill": true, "alignment": "center", "maxLines": 1]),
                    node("refresh", "IconButton", ["label": "Refresh", "icon": "arrow.clockwise", "action": "refresh"]),
                ]]),
                node("skills-view", "SegmentedControl", ["label": "Plugins", "value": "installed", "action": "skills-view", "padding": 12, "options": [
                    ["value": "installed", "label": "Installed"], ["value": "store", "label": "Store"],
                ]]),
                node("search", "TextInput", ["label": "Search plugins", "text": "Search plugins", "value": "", "action": "search", "padding": 12]),
                node("skills-hub-content", "ScrollView", ["fill": true, "padding": 16, "children": [
                    node("review", "NavigationRow", ["label": "Review", "text": "Review project changes and explain the result.", "icon": "puzzlepiece.extension", "action": "review", "selected": true]),
                    node("docs", "NavigationRow", ["label": "Documentation", "text": "Read documentation before modifying project code.", "icon": "puzzlepiece.extension", "action": "docs"]),
                ]]),
            ]]),
        ], title: "Plugins")
        try await capture(XgentIOSPagePresentation(document: plugins, sidebar: nil, model: model),
                          name: "plugins-narrow", width: 320)

        let permissions = try document(mode: "sheet", appearance: "light", nodes: [
            node("back", "Button", ["label": "Back", "action": "back"]),
            node("save-status", "Text", ["text": "Saved", "secondary": true]),
            node("refresh-permissions", "Button", ["label": "Refresh permissions", "action": "refresh-permissions"]),
            node("permissions", "SettingsGroup", ["label": "System permissions", "children": [
                node("permission:camera", "NavigationRow", ["label": "Camera", "text": "Denied: open system settings to enable access.", "icon": "hand.raised", "action": "permission:camera"]),
                node("permission:microphone", "NavigationRow", ["label": "Microphone", "text": "Granted", "icon": "hand.raised", "action": "permission:microphone", "disabled": true]),
            ]]),
            node("personal-access", "SettingsGroup", ["label": "Agent access", "children": [
                node("personal-policy:camera", "Selector", ["label": "Camera", "value": "ask", "action": "personal-policy:camera", "options": [
                    ["value": "allow", "label": "Allow"], ["value": "ask", "label": "Ask"], ["value": "deny", "label": "Deny"],
                ]]),
            ]]),
        ], title: "Permissions")
        try await capture(XgentIOSSheetPresentation(initialDocument: permissions, model: model)
            .dynamicTypeSize(.accessibility2), name: "permissions-accessible", width: 320)

        let memory = try document(mode: "sheet", appearance: "dark", nodes: [
            node("back", "Button", ["label": "Back", "action": "back"]),
            node("save-status", "Text", ["text": "Saved", "secondary": true]),
            node("memory", "SettingsGroup", ["label": "Memory", "children": [
                node("organizer", "Switch", ["label": "Organize memory automatically", "value": true, "action": "organizer"]),
                node("scope", "Selector", ["label": "Scope", "value": "current-project", "action": "scope", "options": [
                    ["value": "all", "label": "All"], ["value": "global", "label": "Global"],
                    ["value": "projects", "label": "Projects"], ["value": "current-project", "label": "Current project"],
                ]]),
            ]]),
        ], title: "Memory")
        try await capture(XgentIOSSheetPresentation(initialDocument: memory, model: model),
                          name: "memory-dark", width: 390)
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

    private func document(mode: String, appearance: String, nodes: [[String: Any]], title: String = "Settings") throws -> XgentDocument {
        let json: [String: Any] = [
            "version": 1, "surface": "fixture-\(mode)", "revision": 1, "mode": mode,
            "title": title, "appearance": appearance, "formFactor": "mobile",
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
                        ["value": "swift", "label": "Workspace · SwiftUI review model", "group": "workspace", "groupLabel": "Workspace"],
                        ["value": "long", "label": "Workspace · A model with a long name that must wrap on narrow displays", "group": "workspace", "groupLabel": "Workspace"],
                        ["value": "second", "label": "Remote · SwiftUI review model", "group": "remote", "groupLabel": "Remote", "disabled": true],
                    ]]),
                    node("context-usage", "ProgressBar", ["label": "Context usage", "current": 12, "total": 100]),
                    node("attach", "FilePicker", ["label": "Attach", "action": "attach", "options": [
                        ["value": "camera", "label": "Camera"], ["value": "photos", "label": "Photos"], ["value": "files", "label": "Files"],
                    ], "children": [
                        node("runtime-thinking", "Switch", ["label": "Think harder", "value": true, "action": "thinking"]),
                        node("runtime-reasoning", "Selector", ["label": "Effort", "value": "high", "action": "reasoning", "options": [
                            ["value": "low", "label": "Low"], ["value": "high", "label": "High"],
                        ]]),
                    ]]),
                    node("send", "IconButton", ["label": "Send", "icon": "arrow.up", "action": "send", "disabled": true]),
                ]]),
            ]]),
        ]])]
    }
}
#endif
