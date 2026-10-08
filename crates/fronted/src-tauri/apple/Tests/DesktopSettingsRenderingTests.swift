#if os(macOS)
import AppKit
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class DesktopSettingsRenderingTests: XCTestCase {
    @MainActor
    func testActualSettingsPresentationFitsItsParentWindow() async throws {
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        for width: CGFloat in [640, 1040] {
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { actions.append($0) }
            let root = try JSONDecoder().decode(XgentDocument.self, from: Data(#"{"version":1,"surface":"root","revision":1,"mode":"root","title":"Chat","appearance":"light","formFactor":"desktop","nodes":[{"id":"welcome","kind":"Text","text":"Chat"}]}"#.utf8))
            model.update(root)
            let host = NSHostingView(rootView: XgentPresentationView(model: model))
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 720), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            host.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(120))
            model.update(try fixture(section: .appearance))
            let deadline = ContinuousClock.now + .seconds(3)
            while !nativeMacAccessibilityTree(window).contains(where: { $0.accessibilityIdentifier() == "settings-close" }),
                  ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(60)) }
            try await Task.sleep(for: .milliseconds(120))
            XCTAssertTrue(window.sheets.isEmpty, "PC settings must be an in-window dialog, not a system sheet")
            let elements = nativeMacAccessibilityTree(window)
            let expected = width < 792 ? "settings-navigation-menu" : "desktop-nav:system"
            XCTAssertTrue(elements.contains { $0.accessibilityIdentifier() == expected })
            XCTAssertFalse(elements.contains { $0.accessibilityText() == "Back to Chat" })
            if width == 1040 {
                let system = try XCTUnwrap(elements.first {
                    $0.accessibilityIdentifier() == "desktop-nav:system" && $0.accessibilityRole() == .button
                })
                let providers = try XCTUnwrap(elements.first {
                    $0.accessibilityIdentifier() == "desktop-nav:providers" && $0.accessibilityRole() == .button
                })
                XCTAssertGreaterThanOrEqual(system.accessibilityFrame().height, 39.5)
                XCTAssertLessThanOrEqual(abs(system.accessibilityFrame().midY - providers.accessibilityFrame().midY), 43,
                    "Compact one-line navigation must not retain the previous 52-point row pitch")
            }
            let close = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "settings-close" })
            XCTAssertGreaterThan(close.accessibilityFrame().width, 0)
            let image = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: image)
            let attachment = XCTAttachment(image: NSImage(cgImage: try XCTUnwrap(image.cgImage), size: host.bounds.size))
            attachment.name = "settings-actual-presentation-\(Int(width))"; attachment.lifetime = .keepAlways; add(attachment)
            let controls = elements.filter { $0.accessibilityIdentifier() == "terminal-shell" }.map {
                "\($0.accessibilityIdentifier() ?? "_"): \($0.accessibilityRole()?.rawValue ?? "_") \(NSStringFromRect($0.accessibilityFrame()))"
            }
            let hierarchy = XCTAttachment(string: controls.joined(separator: "\n"))
            hierarchy.name = "settings-shell-controls-\(Int(width))"; hierarchy.lifetime = .keepAlways; add(hierarchy)
            let shellControls = elements.filter { element in
                guard element.accessibilityIdentifier() == "terminal-shell" else { return false }
                let role = element.accessibilityRole()
                return role == NSAccessibility.Role.button || role == NSAccessibility.Role.popUpButton ||
                    role == NSAccessibility.Role.menuButton
            }
            let shell = try XCTUnwrap(shellControls.first)
            XCTAssertLessThan(shell.accessibilityFrame().width, width / 2,
                "A desktop description must wrap beside its menu instead of pushing it into a full-width second row")
            func descendants(_ view: NSView) -> [NSView] {
                [view] + view.subviews.flatMap { descendants($0) }
            }
            let backdrop = try XCTUnwrap(descendants(host).compactMap { $0 as? XgentDesktopSettingsDismissView }.first)
            XCTAssertTrue(backdrop.enabled)
            XCTAssertNotNil(backdrop.dismiss)
            XCTAssertTrue(backdrop.window === window)
            XCTAssertEqual(backdrop.dialogSize.width / host.bounds.width, 0.866, accuracy: 0.002)
            XCTAssertEqual(backdrop.dialogSize.height / host.bounds.height, 0.866, accuracy: 0.002)
            if width == 1040 {
                window.setContentSize(CGSize(width: 1600, height: 1000))
                host.layoutSubtreeIfNeeded()
                try await Task.sleep(for: .milliseconds(160))
                XCTAssertEqual(backdrop.dialogSize.width / host.bounds.width, 0.866, accuracy: 0.002,
                    "An already-open settings dialog must follow window resizing")
                XCTAssertEqual(backdrop.dialogSize.height / host.bounds.height, 0.866, accuracy: 0.002)
                XCTAssertGreaterThan(backdrop.dialogSize.width, 1000)
                window.setContentSize(CGSize(width: width, height: 720))
                host.layoutSubtreeIfNeeded()
                try await Task.sleep(for: .milliseconds(160))
            }
            // Avoid the resizable window's corner, which AppKit handles before
            // content hit testing. This is in the dialog's 16-point left gutter.
            let outsidePoint = NSPoint(x: 12, y: host.bounds.midY)
            let outside = backdrop.convert(outsidePoint, from: host)
            XCTAssertTrue(backdrop.hitTest(backdrop.convert(outside, to: backdrop.superview)) === backdrop)
            let inside = NSPoint(x: backdrop.bounds.midX, y: backdrop.bounds.midY)
            XCTAssertNil(backdrop.hitTest(backdrop.convert(inside, to: backdrop.superview)),
                "Settings content and empty panel space must never be a dismissal target")
            XCTAssertTrue(host.hitTest(outsidePoint) === backdrop,
                "The actual hosting hierarchy must route the outside pointer to the dismissal target")
            // This point is outside the centered dialog and must dismiss it.
            let windowPoint = host.convert(outsidePoint, to: nil)
            let click = try [NSEvent.EventType.leftMouseDown, .leftMouseUp].enumerated().map { index, type in
                try XCTUnwrap(NSEvent.mouseEvent(with: type, location: windowPoint,
                    modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                    windowNumber: window.windowNumber, context: nil, eventNumber: index + 1,
                    clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0))
            }
            // AppKit controls may track synchronously inside mouseDown. Queue
            // the release before dispatching the press so tracking can finish.
            NSApp.postEvent(click[1], atStart: true)
            window.sendEvent(click[0])
            if let release = NSApp.nextEvent(matching: .leftMouseUp, until: Date(), inMode: .default, dequeue: true) {
                window.sendEvent(release)
            }
            let actionDeadline = ContinuousClock.now + .seconds(3)
            while actions.isEmpty && ContinuousClock.now < actionDeadline { try await Task.sleep(for: .milliseconds(50)) }
            XCTAssertEqual(actions.last?.action, "close", "A real click outside settings must use its close callback")
        }
    }

    @MainActor
    func testNestedModelAndMCPDetailsKeepActionsInsideShortAndScreenConstrainedWindows() async throws {
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        for variant in ["provider-model-settings", "mcp-registry-preview"] {
            for size in [CGSize(width: 480, height: 420), CGSize(width: 1040, height: 920)] {
                for textSize in [DynamicTypeSize.large, .accessibility3] {
                    let model = XgentPresentationModel()
                    var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
                    let root = try JSONDecoder().decode(XgentDocument.self, from: Data(#"{"version":1,"surface":"root","revision":1,"mode":"root","title":"Chat","appearance":"light","formFactor":"desktop","nodes":[{"id":"welcome","kind":"Text","text":"Chat"}]}"#.utf8))
                    model.update(root)
                    let host = NSHostingView(rootView: XgentPresentationView(model: model).dynamicTypeSize(textSize))
                    let window = NSWindow(contentRect: CGRect(origin: .zero, size: size),
                                          styleMask: [.titled], backing: .buffered, defer: false)
                    window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                    defer {
                        if let sheet = window.attachedSheet { window.endSheet(sheet) }
                        model.invalidate(); window.close()
                    }
                    model.update(try fixture(section: .appearance))
                    var deadline = ContinuousClock.now + .seconds(3)
                    while !nativeMacAccessibilityTree(window).contains(where: { $0.accessibilityIdentifier() == "settings-close" }),
                          ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(50)) }
                    XCTAssertTrue(nativeMacAccessibilityTree(window).contains { $0.accessibilityIdentifier() == "settings-close" })
                    var detail: [String: Any] = ["version": 1, "surface": "detail", "revision": 1, "mode": "sheet",
                        "title": "Configuration", "appearance": "light", "formFactor": "desktop", "dismissAction": "close",
                        "nodes": [node("detail", "VStack", ["variant": variant, "fill": true, "children": [
                            node("detail-close", "IconButton", ["label": "Close configuration", "icon": "xmark", "action": "close"]),
                            node("detail-title", "Heading", ["text": "Configuration · 用户自定义模型"]),
                            node("detail-body", "VStack", ["variant": "extension-preview-body", "children": (0..<20).map { index in
                                node("detail-field-\(index)", "TextInput", ["label": "Configuration parameter \(index)",
                                                                        "value": "Editable setting", "action": "edit-\(index)"])
                            }]),
                            node("detail-footer", "HStack", ["variant": "extension-preview-footer", "children": [
                                node("detail-delete", "Button", ["label": "Delete configuration", "action": "delete", "destructive": true]),
                                node("detail-cancel", "Button", ["label": "Cancel unsaved changes", "action": "cancel"]),
                                node("detail-save", "Button", ["label": "Save configuration", "action": "save", "prominent": true])
                            ]])
                        ]])]]
                    let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: detail))
                    try document.validate(); model.update(document)
                    deadline = ContinuousClock.now + .seconds(3)
                    while window.attachedSheet == nil, ContinuousClock.now < deadline {
                        try await Task.sleep(for: .milliseconds(50))
                    }
                    let sheet = try XCTUnwrap(window.attachedSheet)
                    let view = try XCTUnwrap(sheet.contentView)
                    try await Task.sleep(for: .milliseconds(200)); view.layoutSubtreeIfNeeded()
                    let elements = nativeMacAccessibilityTree(sheet)
                    let bounds = sheet.convertToScreen(view.convert(view.bounds, to: nil))
                    let name = "nested-\(variant)-\(Int(size.width))-\(Int(size.height))-\(textSize)"
                    try attachNativeAccessibilityEvidence(elements.map {
                        ["id": $0.accessibilityIdentifier() ?? "", "role": $0.accessibilityRole()?.rawValue ?? "",
                         "text": $0.accessibilityText() ?? "", "frame": NSStringFromRect($0.accessibilityFrame())]
                    }, name: name + "-accessibility")
                    var frames: [CGRect] = []
                    for id in ["detail-close", "detail-delete", "detail-cancel", "detail-save"] {
                        let control = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == id && $0.accessibilityRole() == .button })
                        let frame = control.accessibilityFrame()
                        XCTAssertGreaterThanOrEqual(frame.height, 31.5)
                        XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1)
                        XCTAssertGreaterThanOrEqual(frame.minY, bounds.minY - 1)
                        XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
                        XCTAssertLessThanOrEqual(frame.maxY, bounds.maxY + 1)
                        XCTAssertFalse(frames.contains { $0.intersects(frame) })
                        frames.append(frame)
                    }
                    XCTAssertLessThanOrEqual(bounds.width, 705)
                    XCTAssertLessThanOrEqual(bounds.height, min(736, size.height) + 1)
                    let bitmap = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
                    view.cacheDisplay(in: view.bounds, to: bitmap)
                    let attachment = XCTAttachment(image: NSImage(cgImage: try XCTUnwrap(bitmap.cgImage), size: view.bounds.size))
                    attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
                    let save = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "detail-save" && $0.accessibilityRole() == .button })
                    XCTAssertTrue(save.accessibilityPerformPress())
                    XCTAssertEqual(actions.last?.surface, "detail"); XCTAssertEqual(actions.last?.action, "save")
                    let close = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "detail-close" && $0.accessibilityRole() == .button })
                    XCTAssertTrue(close.accessibilityPerformPress())
                    XCTAssertEqual(actions.last?.surface, "detail"); XCTAssertEqual(actions.last?.action, "close")
                    detail["revision"] = 2; detail["removed"] = true
                    model.update(try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: detail)))
                    deadline = ContinuousClock.now + .seconds(3)
                    while window.attachedSheet != nil, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(50)) }
                    XCTAssertNil(window.attachedSheet)
                    XCTAssertTrue(nativeMacAccessibilityTree(window).contains { $0.accessibilityIdentifier() == "settings-close" },
                                  "Closing a model/MCP detail must preserve its parent settings presentation")
                }
            }
        }
    }

    private enum Section: String, CaseIterable {
        case appearance, systemTools = "system-tools", proxy, about, permissions, providers
    }

    @MainActor
    func testHandwrittenSettingsFitNarrowWideAndAccessibilityWindows() async throws {
        let widths: [CGFloat] = [640, 1040]
        for (width, section) in widths.flatMap({ width in Section.allCases.filter { $0 != .providers }.map { (width, $0) } }) {
            for typeSize in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture(section: section)
                let height: CGFloat = section == .proxy || section == .permissions ? 1100 : 720
                let model = XgentPresentationModel()
                model.update(document)
                let view = XgentDesktopSettingsLayout(node: document.nodes[0], document: document, model: model)
                    .frame(width: width, height: height)
                    .background { XgentThemeBackground() }
                    .dynamicTypeSize(typeSize)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback,
                        appearance: typeSize == .large ? .light : .dark))
                let host = NSHostingView(rootView: view)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: height),
                                      styleMask: [.titled], backing: .buffered, defer: false)
                window.contentView = host
                window.orderFront(nil)
                defer { window.orderOut(nil); window.contentView = nil }
                host.layoutSubtreeIfNeeded()
                try await Task.sleep(nanoseconds: 100_000_000)
                XCTAssertEqual(host.bounds.width, width, accuracy: 1,
                    "Settings must fit the actual window instead of forcing a 900-point minimum")
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: height))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 2_000)
                let attachment = XCTAttachment(image: image)
                attachment.name = "settings-manual-\(section == .appearance ? "" : "\(section.rawValue)-")\(Int(width))-\(typeSize == .large ? "standard" : "accessibility-dark")"
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

    private func node(_ id: String, _ kind: String, _ fields: [String: Any] = [:]) -> [String: Any] {
        var value = fields
        value["id"] = id
        value["kind"] = kind
        return value
    }

    private func fixture(section: Section = .providers) throws -> XgentDocument {
        let appearanceGroups = [
            node("desktop-appearance", "SettingsGroup", ["label": "Appearance", "children": [
                node("thinking", "Switch", ["label": "Show reasoning and thinking", "value": true, "action": "thinking"]),
                node("appearance-preset", "Selector", ["label": "Appearance preset", "value": "matcha", "action": "appearance-preset", "options": [
                    ["value": "current", "label": "Current"], ["value": "stone", "label": "Stone"], ["value": "matcha", "label": "Matcha"],
                ]]),
                node("appearance-customized", "Switch", ["label": "Customize appearance", "value": true, "action": "appearance-customized"]),
                node("appearance-color:accentLight", "ColorInput", ["label": "Light accent", "value": "#abcdef", "action": "appearance-color:accentLight"]),
                node("appearance-color:accentDark", "ColorInput", ["label": "Dark accent", "value": "#123456", "action": "appearance-color:accentDark"]),
                node("appearance-color:sidebarLight", "ColorInput", ["label": "Light sidebar", "value": "#ddeeff", "action": "appearance-color:sidebarLight"]),
                node("appearance-color:sidebarDark", "ColorInput", ["label": "Dark sidebar", "value": "#151515", "action": "appearance-color:sidebarDark"]),
                node("appearance-radius", "Selector", ["label": "Corner radius", "value": "24", "action": "appearance-radius", "options": [["value": "16", "label": "16px"], ["value": "24", "label": "24px"]]]),
                node("appearance-reset", "Button", ["label": "Reset appearance", "action": "appearance-reset"]),
            ]]),
            node("desktop-font-size", "SettingsGroup", ["label": "Font size", "children": [
                node("font-scale:chat", "Selector", ["label": "Chat font size", "value": "1.2", "action": "font-scale:chat", "options": [["value": "1", "label": "Standard"], ["value": "1.2", "label": "Extra large"]]]),
            ]]),
            node("desktop-window", "SettingsGroup", ["label": "Window", "children": [
                node("close-window-behavior", "Selector", ["label": "Closing the window", "value": "minimize", "action": "close-window-behavior", "options": [["value": "minimize", "label": "Minimize to tray"], ["value": "exit", "label": "Exit application"]]]),
            ]]),
        ]
        let systemGroups = [
            node("desktop-terminal", "SettingsGroup", ["label": "Terminal shell", "children": [
                node("terminal-shell", "Selector", ["label": "Terminal shell", "value": "bash", "action": "terminal-shell", "options": [
                    ["value": "auto", "label": "Platform default"], ["value": "bash", "label": "Bash"],
                ]]),
                node("desktop-shell-description", "Text", ["text": "Choose the shell used for new terminal sessions.", "secondary": true]),
                node("desktop-shell-refresh", "Button", ["label": "Refresh status", "action": "desktop-shell-refresh"]),
            ]]),
            node("desktop-tray", "SettingsGroup", ["label": "Tray Menu", "children": [
                node("tray-show-titles", "Switch", ["label": "Show conversation titles", "text": "When off, the tray menu shows Chat 1/2/3 instead of real titles for screen sharing.", "value": false, "action": "tray-show-titles"]),
                node("tray-running-badge", "Switch", ["label": "Menu bar running badge", "text": "Show the running-chat count next to the macOS menu bar icon.", "value": true, "action": "tray-running-badge"]),
            ]]),
        ]
        let proxyGroups = [
            node("desktop-proxy", "SettingsGroup", ["label": "App Proxy", "children": [
                node("proxy-enabled", "Switch", ["label": "Enable app proxy", "text": "The proxy applies to provider requests and shared network tools.", "value": true, "action": "proxy-enabled"]),
                node("proxy-type", "Selector", ["label": "Proxy type", "value": "socks5", "action": "proxy-type", "options": [
                    ["value": "http", "label": "HTTP"], ["value": "socks5", "label": "SOCKS5"],
                ]]),
                node("proxy-host", "TextInput", ["label": "Proxy host", "value": "127.0.0.1", "action": "proxy-host", "commitAction": "proxy-host:commit"]),
                node("proxy-port", "TextInput", ["label": "Port", "value": "1080", "action": "proxy-port", "commitAction": "proxy-port:commit"]),
                node("proxy-username", "TextInput", ["label": "Username (optional)", "value": "", "action": "proxy-username"]),
                node("proxy-password", "TextInput", ["label": "Password (optional)", "value": "", "secure": true, "action": "proxy-password"]),
                node("proxy-password-status", "Text", ["text": "Proxy password saved", "secondary": true]),
                node("proxy-password-clear", "Button", ["label": "Clear", "action": "proxy-password-clear"]),
            ]]),
        ]
        let permissionGroups = [
            node("tool-policy-summary", "SettingsGroup", ["label": "Tool permissions", "children": [
                node("tool-policy-description", "Text", ["text": "Control which tools may run automatically, require confirmation, or remain blocked.", "secondary": true]),
                node("tool-policy-reset", "Button", ["label": "Reset tool permissions", "action": "tool-policy-reset"]),
            ]]),
            node("command-safety", "SettingsGroup", ["label": "Command safety", "children": [
                node("command-safety-mode", "Selector", ["label": "Command safety", "value": "sandboxOffline", "action": "command-safety-mode", "options": [
                    ["value": "auto", "label": "Automatic"], ["value": "ask", "label": "Ask before running"],
                    ["value": "sandbox", "label": "Sandbox"], ["value": "sandboxOffline", "label": "Sandbox without network"],
                ]]),
                node("command-safety-description", "Text", ["text": "The selected mode is used by the shared command executor.", "secondary": true]),
            ]]),
            node("fs", "SettingsGroup", ["label": "Files", "children": [
                node("category:fs:actions", "HStack", ["wrap": true, "accessibilityLabel": "Apply to this category", "children": [
                    node("category:fs:allow", "Button", ["label": "Allow", "action": "category:fs:allow"]),
                    node("category:fs:ask", "Button", ["label": "Ask", "action": "category:fs:ask"]),
                    node("category:fs:deny", "Button", ["label": "Deny", "action": "category:fs:deny"]),
                ]]),
                node("policy:Read", "Selector", ["label": "Read files", "value": "ask", "action": "policy:Read", "options": [
                    ["value": "allow", "label": "Allow"], ["value": "ask", "label": "Ask"], ["value": "deny", "label": "Deny"],
                ]]),
                node("policy:Read:description", "Text", ["text": "Read files from the current workspace without changing their contents.", "secondary": true]),
            ]]),
        ]
        let groups: [[String: Any]]
        let title: String
        switch section {
        case .appearance: groups = desktopGeneralGroups() + appearanceGroups; title = "System"
        case .systemTools: groups = systemGroups; title = "System"
        case .proxy: groups = proxyGroups; title = "System"
        case .about:
            groups = [node("about-name", "Heading", ["text": "XGent"]),
                      node("about-version", "Text", ["text": "v1.0.0", "secondary": true])]
            title = "About"
        case .permissions: groups = permissionGroups; title = "Tool permissions"
        case .providers:
            groups = [node("provider-settings", "SettingsGroup", ["label": "Connection", "children": [
                node("provider-name", "TextInput", ["label": "Provider name", "value": "Example provider", "action": "name"]),
                node("provider-key", "TextInput", ["label": "API key", "value": "", "secure": true, "action": "key"]),
                node("provider-model", "Selector", ["label": "Default model", "value": "current", "action": "model", "options": [
                    ["value": "current", "label": "Current model"],
                    ["value": "alternative", "label": "Alternative model with a longer display name"],
                ]]),
                node("provider-test", "Button", ["label": "Test connection and fetch available models", "action": "test", "prominent": true]),
            ]])]
            title = "Providers"
        }
        let json: [String: Any] = [
            "version": 1, "surface": "settings-manual", "revision": 1, "mode": "sheet",
            "title": "Settings", "appearance": "light", "formFactor": "desktop", "dismissAction": "close", "nodes": [
                node("settings-layout", "SettingsLayout", ["fill": true, "children": [
                    node("settings-sidebar", "VStack", ["children": [
                        node("settings-search", "TextInput", ["label": "Search settings", "value": "", "action": "search"]),
                        node("settings-navigation", "List", ["children": [
                            node("desktop-nav:system", "NavigationRow", ["label": "System", "icon": "gearshape", "selected": title == "System", "action": "system"]),
                            node("desktop-nav:providers", "NavigationRow", ["label": "Providers", "icon": "network", "selected": section == .providers, "action": "providers"]),
                            node("desktop-nav:shortcuts", "NavigationRow", ["label": "Shortcuts", "icon": "keyboard", "action": "shortcuts"]),
                            node("desktop-nav:backup", "NavigationRow", ["label": "Backup and synchronization", "icon": "icloud", "action": "backup"]),
                            node("desktop-nav:computerUse", "NavigationRow", ["label": "Computer use", "icon": "display", "action": "computerUse"]),
                            node("desktop-nav:permissions", "NavigationRow", ["label": "Tool permissions", "icon": "lock.shield", "selected": section == .permissions, "action": "permissions"]),
                            node("desktop-nav:voice", "NavigationRow", ["label": "Voice Input", "icon": "mic", "action": "voice"]),
                            node("desktop-nav:soul", "NavigationRow", ["label": "Soul", "icon": "person.crop.circle", "action": "soul"]),
                            node("desktop-nav:memory", "NavigationRow", ["label": "Memory", "icon": "brain", "action": "memory"]),
                            node("desktop-nav:other", "NavigationRow", ["label": "Other", "icon": "ellipsis.circle", "action": "other"]),
                            node("desktop-nav:access", "NavigationRow", ["label": "Local & Cloud", "icon": "icloud", "action": "access"]),
                            node("desktop-nav:about", "NavigationRow", ["label": "About", "icon": "info.circle", "selected": section == .about, "action": "about"]),
                        ]]),
                        node("settings-close", "IconButton", ["label": "Close", "icon": "xmark", "action": "close"]),
                    ]]),
                    node("settings-detail", "ScrollView", ["children": [
                        node("settings-detail-title", "Heading", ["text": title]),
                    ] + groups]),
                ]]),
            ],
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }

    private func desktopGeneralGroups() -> [[String: Any]] {
        func select(_ id: String, _ label: String, _ value: String, _ options: [[String: String]], _ description: String? = nil) -> [String: Any] {
            var node: [String: Any] = ["id": id, "kind": "Selector", "label": label, "value": value,
                "action": id, "options": options]
            if let description { node["text"] = description }
            return node
        }
        return [
            ["id": "execution-mode", "kind": "SettingsGroup", "children": [
                select("mode", "Execution mode", "tools", [["value": "text", "label": "Chat mode"], ["value": "tools", "label": "Agent mode"]],
                    "Allow tools, file operations and command execution."),
            ]],
            ["id": "desktop-terminal", "kind": "SettingsGroup", "children": [
                select("terminal-shell", "Terminal Shell", "auto", [["value": "auto", "label": "Platform default"], ["value": "bash", "label": "Bash"]],
                    "Reuse the same terminal session. Follow the selected platform shell."),
            ]],
            ["id": "general", "kind": "SettingsGroup", "children": [
                select("theme", "Appearance", "system", [["value": "system", "label": "Automatic"], ["value": "light", "label": "Light"], ["value": "dark", "label": "Dark"]]),
                select("language", "Language", "en-US", [["value": "system", "label": "System"], ["value": "en-US", "label": "English"], ["value": "zh-CN", "label": "简体中文"]]),
            ]],
        ]
    }
}
#endif
