#if os(iOS)
import SnapshotTesting
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
    func testWorkTimelineDuringAndAfterGeneration() async throws {
        let tool = node("edit", "ToolCall", [
            "label": "Edited workspace file", "text": "src/settings/ProviderConnection.swift",
            "variant": "timeline", "status": "completed", "children": [
                node("diff", "CodeBlock", ["label": "ProviderConnection.swift +2 -1", "language": "diff",
                                            "text": "@@ -1,2 +1,2 @@\n-old setting\n+new setting"]),
            ],
        ])
        let running = node("verify", "ToolCall", [
            "label": "Checking the change", "text": "Running the relevant checks",
            "variant": "timeline", "status": "running", "children": [
                node("command", "CodeBlock", ["label": "Command", "language": "shell", "text": "pnpm check"]),
            ],
        ])
        let work = node("work", "Section", ["label": "Working", "children": [
            node("summary", "Text", ["text": "I found the settings behavior and am checking the fix."]),
            tool, running,
        ]])
        func chat(with content: [[String: Any]]) throws -> XgentDocument {
            try document(mode: "root", appearance: "light", nodes: [
                node("chat", "ChatLayout", ["children": [
                    node("toolbar", "HStack", ["children": [
                        node("sidebar", "IconButton", ["label": "Open sidebar", "icon": "sidebar.left",
                                                         "action": "sidebar"]),
                    ]]),
                    node("transcript", "ScrollView", ["children": [
                        node("answer", "ChatMessage", ["role": "assistant", "children": content]),
                    ]]),
                ]]),
            ])
        }
        let model = XgentPresentationModel()
        let live = try chat(with: [work])
        try await capture(XgentIOSRootPresentation(document: live, sidebar: nil, model: model),
                          name: "work-timeline-live", width: 320)
        let completed = try chat(with: [
            node("finished", "Collapsible", ["label": "Worked for 2m 38s", "children": [tool]]),
            node("reply", "Markdown", ["text": "The settings change is complete."]),
        ])
        try await capture(XgentIOSRootPresentation(document: completed, sidebar: nil, model: model),
                          name: "work-timeline-completed", width: 320)
    }

    @MainActor
    func testStreamingQueueAtNarrowAndAccessibleSizes() async throws {
        for (name, width, typeSize) in [
            ("queue-narrow", CGFloat(320), DynamicTypeSize.large),
            ("queue-wide", CGFloat(768), DynamicTypeSize.large),
            ("queue-accessible", CGFloat(390), DynamicTypeSize.accessibility2),
        ] {
            let model = XgentPresentationModel()
            model.update(try document(mode: "root", appearance: "light", nodes: queuedChatNodes))
            try await capture(XgentRootLayout(model: model).dynamicTypeSize(typeSize),
                              name: name, width: width)
        }
    }

    @MainActor
    func testComposerFocusRequestDoesNotReopenDismissedKeyboard() async throws {
        let model = XgentPresentationModel()
        let controller = UIHostingController(rootView: XgentRootLayout(model: model))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        func inputDocument(_ revision: Int, request: Int) throws -> XgentDocument {
            try document(mode: "root", appearance: "light", nodes: [
                node("chat", "ChatLayout", ["children": [
                    node("transcript", "ScrollView", ["value": "conversation", "children": []]),
                    node("composer", "Composer", ["children": [
                        node("draft", "ComposerInput", ["value": "Edit queued instruction", "action": "draft", "focusRequest": request]),
                    ]]),
                ]]),
            ], revision: revision)
        }
        model.update(try inputDocument(1, request: 0))
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertNil(firstResponder(in: window))
        model.update(try inputDocument(2, request: 1))
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertNotNil(firstResponder(in: window), "Editing a queued draft restores the native keyboard")
        window.endEditing(true)
        model.update(try inputDocument(3, request: 1))
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertNil(firstResponder(in: window), "An ordinary update must preserve keyboard dismissal")
        model.update(try inputDocument(4, request: 2))
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertNotNil(firstResponder(in: window))
    }

    @MainActor
    func testImagePreviewAndThumbnailsAtNarrowWideAndAccessibleSizes() async throws {
        let image = try nativeImageFixture().base64EncodedString()
        for (name, width, typeSize) in [
            ("images-narrow", CGFloat(320), DynamicTypeSize.large),
            ("images-wide", CGFloat(768), DynamicTypeSize.large),
            ("images-accessible", CGFloat(390), DynamicTypeSize.accessibility2),
        ] {
            let page = try document(mode: "root", appearance: "light", nodes: [
                node("file", "BrowserLayout", ["fill": true, "children": [
                    node("title", "Heading", ["text": "Workspace image"]),
                    node("activity", "HStack", ["children": [
                        node("thumbnail", "ActivityPreview", ["label": "Screenshot", "value": image, "action": "preview"]),
                        node("missing", "ActivityPreview", ["label": "Running tool", "value": "", "status": "running", "action": "tool"]),
                    ]]),
                    node("image", "MediaPreview", ["label": "photo.png", "language": "image/png", "value": image, "fill": true]),
                ]]),
            ], title: "Image")
            let model = XgentPresentationModel()
            model.update(page)
            try await capture(XgentIOSWorkspacePresentation(document: page, model: model).dynamicTypeSize(typeSize),
                              name: name, width: width)
        }
        let page = try document(mode: "root", appearance: "dark", nodes: [
            node("broken", "MediaPreview", ["label": "broken.png", "language": "image/png", "value": "invalid-image", "fill": true]),
        ], title: "Image")
        let model = XgentPresentationModel()
        model.update(page)
        try await capture(XgentIOSWorkspacePresentation(document: page, model: model),
                          name: "image-error-narrow", width: 320)
        let html = Data("<html><body><h1>Workspace document</h1><p>Native document preview</p></body></html>".utf8)
        let office = try document(mode: "root", appearance: "light", nodes: [
            node("document", "MediaPreview", ["label": "report.doc", "language": "text/html", "value": html.base64EncodedString(), "fill": true]),
        ], title: "Document")
        let officeModel = XgentPresentationModel()
        officeModel.update(office)
        try await capture(XgentIOSPagePresentation(document: office, sidebar: nil, model: officeModel),
                          name: "office-preview-narrow", width: 320)
    }

    @MainActor
    func testWorkspaceCodeEditorAtNarrowWideAccessibleAndDarkSizes() async throws {
        let source = """
        import Foundation

        struct Workspace {
            let title = "你好 👋"
            let longLine = "\(String(repeating: "source text ", count: 24))"
        }
        """
        for (name, width, appearance, typeSize) in [
            ("editor-narrow", CGFloat(320), "light", DynamicTypeSize.large),
            ("editor-wide", CGFloat(768), "light", DynamicTypeSize.large),
            ("editor-accessible", CGFloat(390), "light", DynamicTypeSize.accessibility2),
            ("editor-dark", CGFloat(390), "dark", DynamicTypeSize.large),
        ] {
            let page = try document(mode: "root", appearance: appearance, nodes: [
                node("file", "BrowserLayout", ["fill": true, "children": [
                    node("title", "Heading", ["text": "Example.swift"]),
                    node("code", "TextArea", ["label": "Example.swift", "language": "swift", "value": source,
                        "action": "edit", "fill": true]),
                ]]),
            ], title: "File")
            let model = XgentPresentationModel()
            model.update(page)
            let view = XgentRootLayout(model: model).dynamicTypeSize(typeSize)
            try await capture(view, name: name, width: width)
        }
    }

    @MainActor
    private func firstResponder(in view: UIView) -> UIView? {
        if view.isFirstResponder { return view }
        return view.subviews.lazy.compactMap { self.firstResponder(in: $0) }.first
    }

    @MainActor
    func testSVGPreviewAndThumbnailsAtNarrowWideAndAccessibleSizes() async throws {
        let svg = nativeSVGFixture(width: 800, height: 400, contents: """
        <defs><linearGradient id="g"><stop offset="0" stop-color="#2563eb"/>
          <stop offset="1" stop-color="#9333ea"/></linearGradient></defs>
        <rect x="40" y="40" width="720" height="320" rx="48" fill="url(#g)"/>
        <path d="M 160 200 L 320 120 L 480 280 L 640 160" fill="none" stroke="white" stroke-width="16"/>
        """).base64EncodedString()
        for (name, width, typeSize) in [
            ("svg-narrow", CGFloat(320), DynamicTypeSize.large),
            ("svg-wide", CGFloat(768), DynamicTypeSize.large),
            ("svg-accessible", CGFloat(390), DynamicTypeSize.accessibility2),
        ] {
            let page = try document(mode: "root", appearance: "light", nodes: [
                node("file", "BrowserLayout", ["fill": true, "children": [
                    node("title", "Heading", ["text": "Workspace SVG"]),
                    node("thumbnail", "ActivityPreview", ["label": "Vector drawing", "value": svg, "action": "preview"]),
                    node("image", "MediaPreview", ["label": "diagram.svg", "language": "image/svg+xml", "value": svg, "fill": true]),
                ]]),
            ], title: "SVG")
            let model = XgentPresentationModel()
            model.update(page)
            try await capture(XgentIOSWorkspacePresentation(document: page, model: model).dynamicTypeSize(typeSize),
                              name: name, width: width)
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
                    node("workspaces", "Heading", ["text": "Workspaces"]),
                    node("travel-group", "NavigationRow", ["label": "Destinations", "icon": "folder.fill",
                                                            "variant": "sidebar", "action": "toggle-group"]),
                    node("fort-mason", "NavigationRow", ["label": "Fort Mason", "icon": "folder.fill",
                                                           "variant": "sidebar", "indent": 18, "action": "toggle-project"]),
                    node("fort-chat", "NavigationRow", ["label": "Fort Mason live demo",
                                                          "variant": "sidebar-conversation", "indent": 54,
                                                          "selected": true, "action": "open-fort-chat"]),
                    node("fort-work", "NavigationRow", ["label": "Choose a DevDay outfit",
                                                          "variant": "sidebar-conversation", "indent": 54,
                                                          "action": "open-fort-work"]),
                    node("flight", "NavigationRow", ["label": "Flight Journal", "icon": "folder.fill",
                                                       "variant": "sidebar", "action": "toggle-flight"]),
                    node("flight-work", "NavigationRow", ["label": "Integrate flight data API",
                                                            "variant": "sidebar-conversation", "indent": 36,
                                                            "action": "open-flight-work"]),
                    node("recent", "Heading", ["text": "Recent chats"]),
                    node("conversation", "NavigationRow", ["label": "Review SwiftUI layout",
                                                             "variant": "sidebar-conversation", "action": "open"]),
                ]]),
                node("sidebar-footer", "HStack", ["children": [
                    node("new-chat", "Button", ["label": "New chat", "action": "new"]),
                    node("settings", "IconButton", ["label": "Settings", "icon": "gearshape", "action": "settings"]),
                ]]),
            ]]),
        ])
        try await capture(XgentIOSRootPresentation(document: chat, sidebar: sidebar, model: model),
                          name: "sidebar-narrow", width: 320)

        let collapsedSidebar = try document(mode: "sidebar", appearance: "light", nodes: [
            node("sidebar-layout", "VStack", ["children": [
                node("sidebar-title", "Heading", ["text": "Xgent"]),
                node("sidebar-list", "List", ["children": [
                    node("workspaces", "Heading", ["text": "Workspaces"]),
                    node("travel-group", "NavigationRow", ["label": "Destinations", "icon": "folder",
                                                            "variant": "sidebar", "action": "toggle-group"]),
                    node("flight", "NavigationRow", ["label": "Flight Journal", "icon": "folder",
                                                       "variant": "sidebar", "action": "toggle-flight"]),
                    node("recent", "Heading", ["text": "Recent chats"]),
                    node("conversation", "NavigationRow", ["label": "Review SwiftUI layout",
                                                             "variant": "sidebar-conversation", "action": "open"]),
                ]]),
            ]]),
        ])
        try await capture(XgentIOSRootPresentation(document: chat, sidebar: collapsedSidebar, model: model),
                          name: "sidebar-collapsed", width: 320)
    }

    @MainActor
    func testSettingsFieldsAndWorkDetailsAtReadableSizes() async throws {
        for (suffix, width, typeSize) in [
            ("narrow", CGFloat(320), DynamicTypeSize.large),
            ("wide", CGFloat(768), DynamicTypeSize.large),
            ("accessible", CGFloat(390), DynamicTypeSize.accessibility2),
        ] {
            let model = XgentPresentationModel()
            let settings = try document(mode: "sheet", appearance: "light", nodes: [
                node("provider", "SettingsGroup", ["label": "Provider connection", "children": [
                    node("name", "TextInput", ["label": "Name", "value": "Workspace provider", "action": "name"]),
                    node("url", "TextInput", ["label": "Base URL", "value": "https://api.example.com/v1", "action": "url"]),
                    node("key", "TextInput", ["label": "API Key", "value": "test-secret", "secure": true, "action": "key"]),
                    node("format", "Selector", ["label": "Request format", "value": "chat", "action": "format", "options": [
                        ["value": "chat", "label": "Chat Completions"], ["value": "responses", "label": "Responses API"],
                    ]]),
                ]]),
                node("behavior", "SettingsGroup", ["label": "Execution", "children": [
                    node("mode", "SegmentedControl", ["label": "Execution target", "value": "local", "action": "mode", "options": [
                        ["value": "local", "label": "On device"], ["value": "remote", "label": "Paired computer"],
                    ]]),
                    node("permissions", "NavigationRow", ["label": "Tool permissions", "text": "Choose which actions need your approval.", "icon": "lock.shield", "action": "permissions"]),
                ]]),
            ], title: "Provider")
            try await capture(XgentIOSSheetPresentation(initialDocument: settings, model: model)
                .dynamicTypeSize(typeSize), name: "settings-fields-\(suffix)", width: width)

            let work = try document(mode: "sheet", appearance: "dark", nodes: [
                node("summary", "Text", ["text": "Reviewing the workspace and preparing the requested changes."]),
                node("shell", "ToolCall", ["label": "RunShellCommand", "text": "python3 scripts/check_workspace.py --include src/settings", "status": "running", "children": [
                    node("arguments", "CodeBlock", ["label": "Arguments", "language": "json", "text": "{\"command\": \"python3 scripts/check_workspace.py\"}"]),
                ]]),
                node("read", "ToolCall", ["label": "ReadWorkspaceFile", "text": "src/settings/ProviderConnection.swift", "status": "completed"]),
                node("fetch", "ToolCall", ["label": "FetchRemoteDocumentation", "text": "The server could not be reached. Check the connection and retry.", "status": "error"]),
            ], title: "Work activity")
            try await capture(XgentIOSSheetPresentation(initialDocument: work, model: model)
                .dynamicTypeSize(typeSize), name: "work-details-\(suffix)", width: width)
        }
    }

    @MainActor
    func testModelGroupsAndLongSettingsHeader() async throws {
        let model = XgentPresentationModel()
        let chat = try document(mode: "root", appearance: "dark", nodes: chatNodes)
        model.update(chat)
        let composer = try XCTUnwrap(chat.nodes.first?.children?.first { $0.id == "composer" })
        let actions = try XCTUnwrap(composer.children?.first { $0.id == "composer-actions" })
        let modelNode = try XCTUnwrap(actions.children?.first { $0.id == "model" })
        try await capture(XgentIOSModelPicker(node: modelNode, document: chat, model: model),
                          name: "model-groups-narrow", width: 320)
        let lightChat = try document(mode: "root", appearance: "light", nodes: chatNodes)
        let lightModel = XgentPresentationModel()
        lightModel.update(lightChat)
        let lightComposer = try XCTUnwrap(lightChat.nodes.first?.children?.first { $0.id == "composer" })
        let lightActions = try XCTUnwrap(lightComposer.children?.first { $0.id == "composer-actions" })
        let lightModelNode = try XCTUnwrap(lightActions.children?.first { $0.id == "model" })
        try await capture(XgentIOSModelPicker(node: lightModelNode, document: lightChat, model: lightModel),
                          name: "model-groups-light-narrow", width: 320)
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
        // SwiftPM tests have no application key window. SnapshotTesting renders
        // the hosting view's layers and captures WKWebView children separately.
        let strategy = Snapshotting<UIViewController, UIImage>.image(size: size)
        let image = await withCheckedContinuation { continuation in
            strategy.snapshot(controller).run { continuation.resume(returning: $0) }
        }
        XCTAssertEqual(image.size, size)
        XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 10_000)
        let pixels = try XCTUnwrap(image.cgImage?.dataProvider?.data) as Data
        XCTAssertGreaterThan(Set(pixels).count, 8, "\(name) must contain rendered content, not a blank image")
        if name == "model-groups-narrow" || name == "model-groups-light-narrow" {
            let bitmap = try XCTUnwrap(image.cgImage)
            let bytesPerPixel = bitmap.bitsPerPixel / 8
            XCTAssertGreaterThanOrEqual(bytesPerPixel, 3)
            let offset = (bitmap.height * 3 / 4) * bitmap.bytesPerRow
                + (bitmap.width / 2) * bytesPerPixel
            let channels = (0..<bytesPerPixel).map { pixels[offset + $0] }
            if name == "model-groups-narrow" {
                XCTAssertGreaterThanOrEqual(channels.filter { $0 < 100 }.count, 3,
                                            "Dark model picker needs a dark background")
            } else {
                XCTAssertGreaterThanOrEqual(channels.filter { $0 > 180 }.count, 3,
                                            "Light model picker needs a light background")
                func darkTextPixels(x: Range<Int>, y: Range<Int>, below limit: UInt8) -> Int {
                    var count = 0
                    for row in stride(from: y.lowerBound, to: y.upperBound, by: 2) {
                        for column in stride(from: x.lowerBound, to: x.upperBound, by: 2) {
                            let position = row * bitmap.bytesPerRow + column * bytesPerPixel
                            if (0..<bytesPerPixel).filter({ pixels[position + $0] < limit }).count >= 3 {
                                count += 1
                            }
                        }
                    }
                    return count
                }
                XCTAssertGreaterThan(darkTextPixels(x: bitmap.width / 25..<bitmap.width / 3,
                                                    y: bitmap.height / 80..<bitmap.height / 16,
                                                    below: 100), 25,
                                     "Light model picker title must be readable")
                XCTAssertGreaterThan(darkTextPixels(x: bitmap.width / 10..<bitmap.width / 2,
                                                    y: bitmap.height / 16..<bitmap.height / 10,
                                                    below: 150), 25,
                                     "Light model picker search field must be readable")
            }
        }
        if name == "chat-narrow" {
            let bitmap = try XCTUnwrap(image.cgImage)
            let bytesPerPixel = bitmap.bitsPerPixel / 8
            XCTAssertGreaterThanOrEqual(bytesPerPixel, 3)
            var foregroundPixels = 0
            for y in (bitmap.height * 3 / 4)..<bitmap.height {
                for x in (bitmap.width / 10)..<(bitmap.width * 9 / 10) {
                    let offset = y * bitmap.bytesPerRow + x * bytesPerPixel
                    if (0..<3).filter({ pixels[offset + $0] < 100 }).count >= 2 {
                        foregroundPixels += 1
                    }
                }
            }
            XCTAssertGreaterThan(foregroundPixels, 50,
                                 "The bottom composer must render visible input and controls")
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func node(_ id: String, _ kind: String, _ properties: [String: Any] = [:]) -> [String: Any] {
        properties.merging(["id": id, "kind": kind]) { _, value in value }
    }

    private func document(mode: String, appearance: String, nodes: [[String: Any]], title: String = "Settings", revision: Int = 1) throws -> XgentDocument {
        let json: [String: Any] = [
            "version": 1, "surface": "fixture-\(mode)", "revision": revision, "mode": mode,
            "title": title, "appearance": appearance, "formFactor": "mobile",
            "dismissAction": "dismiss", "nodes": nodes,
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }

    private var queuedChatNodes: [[String: Any]] {
        [node("chat", "ChatLayout", ["children": [
            node("transcript", "ScrollView", ["value": "conversation", "children": [
                node("answer", "ChatMessage", ["role": "assistant", "children": [
                    node("stream", "Markdown", ["text": "Working on the current request…"]),
                ]]),
            ]]),
            node("composer", "Composer", ["children": [
                node("queued-turns", "Collapsible", ["label": "Queue 2", "value": "conversation", "children": [
                    node("queued-turns-list", "ScrollView", ["maxHeight": 160, "children": [
                        node("queued-first", "HStack", ["children": [
                            node("queued-preview", "Text", ["text": "Review the narrow layout with a long instruction", "maxLines": 2]),
                            node("queued-menu", "Menu", ["label": "Queued instruction", "icon": "ellipsis", "variant": "compact", "children": [
                                node("edit", "Button", ["label": "Edit", "action": "edit", "icon": "square.and.pencil"]),
                                node("run", "Button", ["label": "Interrupt and run", "action": "run", "icon": "play"]),
                                node("remove", "Button", ["label": "Remove", "action": "remove", "icon": "trash", "destructive": true]),
                            ]]),
                        ]]),
                        node("queued-attachment", "Text", ["text": "Attachment message · 2 attachments", "maxLines": 2]),
                    ]]),
                ]]),
                node("draft", "ComposerInput", ["label": "Message Xgent", "value": "Next instruction", "action": "draft", "focusRequest": 0]),
                node("composer-actions", "HStack", ["children": [
                    node("attach", "FilePicker", ["label": "Attach", "action": "attach", "options": [["value": "files", "label": "Files"]]]),
                    node("composer-spacer", "Spacer"),
                    node("send", "IconButton", ["label": "Add to queue", "icon": "arrow.up", "action": "send", "prominent": true]),
                    node("stop", "IconButton", ["label": "Stop generation", "icon": "stop.fill", "action": "stop"]),
                ]]),
            ]]),
        ]])]
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
