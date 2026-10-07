#if os(macOS)
import AppKit
import SwiftUI
import WebKit
import XCTest
@testable import XgentNativeUI

final class WindowChromeTests: XCTestCase {
    @MainActor func testWindowContextSharesPanelSelectionAndKeepsWebsiteTitlesAndURLs() throws {
        let model = XgentPresentationModel()
        defer { model.invalidate() }
        model.update(try document("chat", nodes: [["id": "chat", "kind": "ChatLayout", "children": []]]))
        let browser = try document("browser", mode: "panel", nodes: [["id": "browser-tab-items", "kind": "VStack", "children": [
            ["id": "page:a", "kind": "Button", "label": "Apple Developer", "text": "https://developer.apple.com/documentation/swiftui", "selected": true, "action": "select-a"],
            ["id": "page:b", "kind": "Button", "label": "A long website title", "text": "https://example.test/a/long/path", "selected": false, "action": "select-b"]]],
            ["id": "browser-navigation", "kind": "HStack", "children": [
                ["id": "browser-back", "kind": "IconButton", "label": "Back", "icon": "arrow.left", "action": "browser-back"],
                ["id": "browser-forward", "kind": "IconButton", "label": "Forward", "icon": "arrow.right", "disabled": true, "action": "browser-forward"]]]])
        model.update(browser)
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let context = XgentWindowToolbarContext(model: model)
        XCTAssertEqual(context.tabs.map(\.title), ["Apple Developer", "A long website title"])
        XCTAssertEqual(context.tabs.first?.subtitle, "https://developer.apple.com/documentation/swiftui")
        XCTAssertEqual(context.selectedTitle, "Apple Developer")
        XCTAssertEqual(context.navigation?.surface, "browser")
        XCTAssertEqual(context.forward?.disabled, true)
        try XCTUnwrap(context.tabs.last).select(model)
        XCTAssertEqual(actions.last?.surface, "browser")
        XCTAssertEqual(actions.last?.action, "select-b")
        XCTAssertEqual(model.workspaceState.selectedSurface, "browser")
        model.workspaceState.visible = false
        model.update(try document("browser", mode: "panel", revision: 2, nodes: browserNodes()))
        XCTAssertFalse(model.workspaceState.visible, "Ordinary page output must not reopen a collapsed right sidebar")
        XCTAssertEqual(XgentWindowToolbarContext(model: model).selectedTitle, "Chat title")
        let oldTab = try XCTUnwrap(context.tabs.first)
        model.update(try document("browser", mode: "panel", revision: 3, nodes: [["id": "page:a", "kind": "Button", "action": "replacement"]]))
        oldTab.select(model)
        XCTAssertFalse(model.workspaceState.visible, "A retired page tab cannot change current sidebar visibility")
        XCTAssertEqual(actions.count, 1)
    }

    @MainActor func testFileAndTerminalTabsUseTheirExistingActionsAndSelectionPayloads() throws {
        let model = XgentPresentationModel()
        defer { model.invalidate() }
        model.update(try document("chat", nodes: [["id": "chat", "kind": "ChatLayout", "children": []]]))
        model.update(try document("files", mode: "panel", nodes: [["id": "workspace-editor-tabs", "kind": "VStack", "children": [
            ["id": "file:first", "kind": "HStack", "label": "main.swift", "text": "/project/main.swift", "selected": true,
             "children": [["id": "select-file:first", "kind": "Button", "action": "select-file:first"]]],
            ["id": "file:second", "kind": "HStack", "label": "index.ts", "text": "/project/index.ts", "selected": false,
             "children": [["id": "select-file:second", "kind": "Button", "action": "select-file:second"]]]]]]))
        model.update(try document("terminal", mode: "panel", nodes: [["id": "terminal-session", "kind": "Selector", "value": "one", "action": "select-terminal",
             "options": [["value": "one", "label": "Build shell"], ["value": "two", "label": "Review shell"]]]]))
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let tabs = XgentWindowToolbarContext(model: model).tabs
        XCTAssertEqual(tabs.map(\.title), ["main.swift", "index.ts", "Build shell", "Review shell"])
        XCTAssertEqual(tabs.first?.subtitle, "/project/main.swift")
        XCTAssertEqual(tabs.first(where: { $0.selected })?.title, "Build shell")
        try XCTUnwrap(tabs.last).select(model)
        XCTAssertEqual(actions.last?.action, "select-terminal")
        XCTAssertEqual(actions.last?.value, .string("two"))
        tabs[1].select(model)
        XCTAssertEqual(actions.last?.action, "select-file:second")
        XCTAssertEqual(model.workspaceState.selectedSurface, "files")
    }

    @MainActor func testSettingsOverlayOwnsWindowBackAndRetiresUnderlyingTabInteractions() throws {
        let model = XgentPresentationModel()
        defer { model.invalidate() }
        model.update(try document("chat", nodes: [["id": "chat", "kind": "ChatLayout", "children": [
            ["id": "window-back", "kind": "IconButton", "label": "Previous chat", "action": "chat-back"]]]]))
        model.update(try document("browser", mode: "panel", nodes: browserNodes()))
        let tab = try XCTUnwrap(XgentWindowToolbarContext(model: model).tabs.first)
        model.workspaceState.visible = false
        model.update(try document("settings", mode: "sheet", nodes: [
            ["id": "back", "kind": "Button", "label": "Provider list", "action": "settings-back"]]))
        let context = XgentWindowToolbarContext(model: model)
        XCTAssertEqual(context.selectedTitle, "settings")
        XCTAssertEqual(context.navigation?.surface, "settings")
        XCTAssertEqual(context.back?.action, "settings-back")
        XCTAssertNil(context.forward)
        XCTAssertFalse(context.supportsPanels)
        XCTAssertTrue(context.tabs.isEmpty)
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        tab.select(model)
        XCTAssertFalse(model.workspaceState.visible)
        XCTAssertTrue(actions.isEmpty)
        XCTAssertFalse(context.closeSelectedTab())
        model.send(try XCTUnwrap(context.back), in: try XCTUnwrap(context.navigation))
        XCTAssertEqual(actions.last?.action, "settings-back")
    }

    @MainActor func testActualHostInstallsNativeToolbarWithoutCoveringContentAndRestoresWindowOnReset() async throws {
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        for width: CGFloat in [320, 640, 1156] {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 720),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                                  backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            let originalToolbar = NSToolbar(identifier: "original")
            window.toolbar = originalToolbar
            window.toolbarStyle = .unifiedCompact
            window.title = "Original window"
            let container = try XCTUnwrap(window.contentView)
            let transport = WKWebView(frame: container.bounds)
            transport.autoresizingMask = [.width, .height]
            container.addSubview(transport)
            window.makeKeyAndOrderFront(nil)
            let pointer = Unmanaged.passUnretained(transport).toOpaque()
            defer { xgentNativeUIReset(pointer); window.orderOut(nil); window.contentView = nil }
            transport.loadHTMLString("<script>window.nativeActions=[];window.addEventListener('xgent:native-action',e=>{e.preventDefault();window.nativeActions.push(e.detail)});</script>", baseURL: nil)
            let deadline = ContinuousClock.now + .seconds(10)
            while transport.isLoading, ContinuousClock.now < deadline { try await Task.sleep(nanoseconds: 50_000_000) }
            XCTAssertFalse(transport.isLoading)
            // Encode the same DTO through the public C bridge used by Tauri.
            XCTAssertEqual(try publish(rootPayload(), to: pointer), 0)
            container.layoutSubtreeIfNeeded()
            try await Task.sleep(nanoseconds: 300_000_000)
            let toolbar = try XCTUnwrap(window.toolbar)
            XCTAssertFalse(toolbar === originalToolbar)
            XCTAssertEqual(window.toolbarStyle, .unified)
            XCTAssertFalse(toolbar.showsBaselineSeparator)
            XCTAssertEqual(window.title, "Chat title")
            let native = try XCTUnwrap(container.subviews.first { $0 is XgentNativePresentationContainer })
            let nativeFrame = native.convert(native.bounds, to: nil)
            XCTAssertLessThanOrEqual(nativeFrame.maxY, window.contentLayoutRect.maxY + 0.5,
                                     "The execution container must reserve the actual window toolbar area")
            let traffic = try XCTUnwrap(window.standardWindowButton(.closeButton))
            let trafficFrame = traffic.convert(traffic.bounds, to: nil)
            var frames: [CGRect] = []
            for name in ["back", "forward", "left", "right"] {
                let item = try XCTUnwrap(toolbar.items.first { $0.itemIdentifier.rawValue == "xgent.window.\(name)" })
                XCTAssertTrue(try XCTUnwrap(toolbar.visibleItems).contains { $0 === item }, "Essential controls must remain visible at width \(width)")
                let button = try XCTUnwrap(item.view as? NSButton)
                XCTAssertEqual(button.accessibilityIdentifier(), "xgent-window-\(name)")
                let frame = button.convert(button.bounds, to: nil)
                XCTAssertGreaterThanOrEqual(frame.width, 31.5)
                XCTAssertGreaterThanOrEqual(frame.height, 31.5)
                XCTAssertGreaterThanOrEqual(frame.minX, 0)
                XCTAssertLessThanOrEqual(frame.maxX, window.frame.width + 0.5)
                XCTAssertGreaterThanOrEqual(frame.minY, nativeFrame.maxY - 0.5)
                XCTAssertFalse(frame.intersects(trafficFrame))
                XCTAssertFalse(frames.contains { $0.intersects(frame) })
                frames.append(frame)
            }
            let forward = try XCTUnwrap(toolbar.items.first { $0.itemIdentifier.rawValue == "xgent.window.forward" }?.view as? NSButton)
            forward.performClick(nil)
            forward.performClick(nil)
            var received: [[String: Any]] = []
            let actionDeadline = ContinuousClock.now + .seconds(5)
            repeat {
                try await Task.sleep(nanoseconds: 50_000_000)
                received = (try await transport.evaluateJavaScript("window.nativeActions")) as? [[String: Any]] ?? []
            } while received.isEmpty && ContinuousClock.now < actionDeadline
            XCTAssertEqual(received.count, 1)
            XCTAssertEqual(received.first?["action"] as? String, "forward")
            let frameView = try XCTUnwrap(container.superview)
            let bitmap = try XCTUnwrap(frameView.bitmapImageRepForCachingDisplay(in: frameView.bounds))
            frameView.cacheDisplay(in: frameView.bounds, to: bitmap)
            let image = NSImage(size: frameView.bounds.size)
            image.addRepresentation(bitmap)
            let attachment = XCTAttachment(image: image)
            attachment.name = "actual-window-toolbar-\(Int(width))"
            attachment.lifetime = .keepAlways
            add(attachment)
            xgentNativeUIReset(pointer)
            XCTAssertTrue(window.toolbar === originalToolbar)
            XCTAssertEqual(window.toolbarStyle, .unifiedCompact)
            XCTAssertEqual(window.title, "Original window")
            XCTAssertFalse(transport.isAccessibilityHidden())
        }
    }

    private func browserNodes() -> [[String: Any]] {
        [["id": "browser-tab-items", "kind": "VStack", "children": [
            ["id": "page:a", "kind": "Button", "label": "Updated page", "text": "https://example.test", "selected": true, "action": "select-a"]]]]
    }
    private func document(_ surface: String, mode: String = "root", revision: Int = 1,
                          nodes: [[String: Any]]) throws -> XgentDocument {
        var payload: [String: Any] = ["version": 1, "surface": surface, "revision": revision, "mode": mode,
                                     "title": mode == "root" ? "Chat title" : surface, "appearance": "light", "formFactor": "desktop", "nodes": nodes]
        if mode == "panel" {
            payload["dismissAction"] = "close"
            payload["workspacePanel"] = ["focusRequest": 0, "openLabel": "Show panel", "returnLabel": "Return to chat",
                                         "expandLabel": "Expand", "restoreLabel": "Restore", "closeLabel": "Hide panel"]
        }
        let value = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try value.validate()
        return value
    }
    private func rootPayload() -> [String: Any] {
        ["version": 1, "surface": "chat", "revision": 1, "mode": "root", "title": "Chat title", "appearance": "light", "formFactor": "desktop",
         "nodes": [["id": "chat", "kind": "ChatLayout", "fill": true, "children": [
            ["id": "toolbar", "kind": "HStack", "children": [
                ["id": "window-back", "kind": "IconButton", "label": "Back", "icon": "arrow.left", "disabled": true, "action": "back"],
                ["id": "window-forward", "kind": "IconButton", "label": "Forward", "icon": "arrow.right", "action": "forward"],
                ["id": "sidebar", "kind": "IconButton", "label": "Show sidebar", "icon": "sidebar.leading", "action": "sidebar"],
                ["id": "window-right-sidebar", "kind": "IconButton", "label": "Show tools", "icon": "sidebar.trailing", "action": "tools"]]],
            ["id": "content", "kind": "Text", "text": "Visible conversation content"]]]]]
    }
    @MainActor private func publish(_ payload: [String: Any], to pointer: UnsafeMutableRawPointer) throws -> Int32 {
        let json = try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: payload), encoding: .utf8))
        return json.withCString { xgentNativeUIUpdate(pointer, nil, $0, false) }
    }
}
#endif
