#if os(macOS)
import AppKit
import SnapshotTesting
import SwiftUI
import SwiftTerm
import XCTest
@testable import XgentNativeUI

private struct WorkspaceMainProbe: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.identifier = NSUserInterfaceItemIdentifier("workspace-main-probe")
        return view
    }
    func updateNSView(_ view: NSView, context: Context) {}
}

final class WorkspacePanelRenderingTests: XCTestCase {
    @MainActor func testPanelAndDockHeadersRemainUsableWithInstalledWindowChrome() async throws {
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        let model = XgentPresentationModel()
        defer { model.invalidate() }
        let rootPayload: [String: Any] = ["version": 1, "surface": "chat", "revision": 1, "mode": "root",
            "title": "Chat", "formFactor": "desktop", "nodes": [["id": "chat", "kind": "ChatLayout", "children": [
                ["id": "workspace-panel-actions", "kind": "Menu", "label": "Tools", "children": [
                    ["id": "workspace-new-browser", "kind": "Button", "label": "New browser tab", "action": "new-browser"]]]]]]]
        let chat = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: rootPayload))
        try chat.validate()
        model.update(chat)
        model.update(try panel("browser", nodes: [["id": "browser-tab-items", "kind": "VStack", "children": [
            ["id": "browser-tab:first", "kind": "Button", "label": "First website", "selected": true, "action": "first"],
            ["id": "browser-tab:second", "kind": "Button", "label": "Second website", "action": "second"]]]]))
        model.update(try panel("terminal", nodes: [
            ["id": "terminal-session", "kind": "Selector", "label": "Shell", "value": "shell-one", "action": "select-shell",
             "options": [["value": "shell-one", "label": "System shell"], ["value": "shell-two", "label": "Second shell"]]],
            ["id": "terminal-new", "kind": "Button", "label": "New terminal", "action": "new-terminal"]]))
        model.workspaceState.dock("terminal")
        model.windowChromeInstalled = true
        var actions: [XgentAction] = []
        model.actionSink = { action in
            actions.append(action)
            model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
        }
        let layout = XgentDesktopWorkspaceLayout(model: model, minimumMainWidth: 440, enabled: true) { WorkspaceMainProbe() }
            .environment(\.accessibilityEnabled, true)
            .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
        let host = NSHostingView(rootView: layout)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 960, height: 720), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let elements = nativeMacAccessibilityTree(window)
        for id in ["xgent-workspace-tab:browser:browser-tab:first", "xgent-workspace-tab:browser:browser-tab:second",
                   "xgent-workspace-tab:terminal:shell-one", "xgent-workspace-tab:terminal:shell-two"] {
            XCTAssertNotNil(elements.first { $0.accessibilityIdentifier() == id }, id)
        }
        for (id, action) in [("xgent-workspace-panel-add", "new-browser"), ("xgent-workspace-panel-dock-add", "new-terminal")] {
            let button = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == id && $0.accessibilityRole() == .button }, id)
            let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
            let frame = button.accessibilityFrame()
            XCTAssertGreaterThan(frame.width, 0, id)
            XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1, id)
            XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1, id)
            XCTAssertTrue(button.accessibilityPerformPress(), id)
            XCTAssertEqual(actions.last?.action, action)
        }
    }

    @MainActor
    func testDockFitsBothWidthsAndHidesTheBrowserViewportWhenAnotherPanelOpens() async throws {
        for width in [CGFloat(640), CGFloat(1280)] {
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { action in
                actions.append(action)
                model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId,
                                                 ok: true, error: nil))
            }
            model.update(try panel("browser", nodes: [["id": "browser-layout", "kind": "BrowserLayout", "children": [
                ["id": "browser-viewport", "kind": "BrowserViewport", "label": "Browser content", "action": "viewport"],
            ]]]))
            let layout = XgentDesktopWorkspaceLayout(model: model, minimumMainWidth: 440, enabled: true) {
                VStack {
                    Text("Main conversation stays in its own pane")
                    WorkspaceMainProbe()
                }
            }
            .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
            let root = NSHostingView(rootView: layout)
            let size = CGSize(width: width, height: 720)
            root.frame = CGRect(origin: .zero, size: size)
            root.layoutSubtreeIfNeeded()
            try await Task.sleep(nanoseconds: 500_000_000)
            if width == 640 {
                XCTAssertNil(probe(root), "A narrow window must display one usable pane")
            } else {
                let main = try XCTUnwrap(probe(root))
                XCTAssertGreaterThanOrEqual(main.bounds.width, 439)
                let frame = main.convert(main.bounds, to: root)
                XCTAssertGreaterThanOrEqual(frame.minX, -1)
                XCTAssertLessThanOrEqual(frame.maxX, width - 359)
            }
            let viewportEvents = try actions.filter { $0.action == "viewport" }.map(viewport)
            let visible = try XCTUnwrap(viewportEvents.last { $0["visible"] as? Bool == true })
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(visible["width"] as? Double), 300)
            let strategy = Snapshotting<NSView, NSImage>.image(size: size)
            let image = await withCheckedContinuation { continuation in
                strategy.snapshot(root).run { continuation.resume(returning: $0) }
            }
            let bitmap = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation)))
            XCTAssertGreaterThan(try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).count, 1_500)
            let attachment = XCTAttachment(image: image)
            attachment.name = "workspace-dock-\(Int(width))"
            attachment.lifetime = .keepAlways
            add(attachment)
            model.update(try panel("files", nodes: [["id": "files", "kind": "Text", "text": "Workspace files"]]))
            root.layoutSubtreeIfNeeded()
            try await Task.sleep(nanoseconds: 300_000_000)
            let events = try actions.filter { $0.action == "viewport" }.map(viewport)
            XCTAssertEqual(events.last?["visible"] as? Bool, false,
                           "The backend WebKit overlay must hide when its panel loses visibility")
            model.invalidate()
        }
    }

    @MainActor
    func testBottomTerminalRendersRealOutputAlongsideBrowserAndWideChat() async throws {
        for width in [CGFloat(640), CGFloat(1280)] {
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { action in
                actions.append(action)
                model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
            }
            let output = Data("docked-system-shell-output\r\n$ ".utf8)
            let packet: [String: Any] = ["sessionId": "dock", "generation": 1, "startOffset": 0,
                "endOffset": output.count, "bytes": output.base64EncodedString(), "enabled": true]
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: packet), as: UTF8.self)
            model.update(try panel("browser", nodes: [["id": "browser-layout", "kind": "BrowserLayout", "children": [
                ["id": "browser-viewport", "kind": "BrowserViewport", "action": "viewport"]]]]))
            model.update(try panel("terminal", nodes: [["id": "terminal-layout", "kind": "TerminalLayout", "children": [
                ["id": "terminal-viewport", "kind": "TerminalViewport", "action": "terminal-events", "value": encoded]]]]))
            model.workspaceState.dock("terminal")
            let layout = XgentDesktopWorkspaceLayout(model: model, minimumMainWidth: 440, enabled: true) {
                WorkspaceMainProbe()
            }.modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
            let root = NSHostingView(rootView: layout)
            let size = CGSize(width: width, height: 560)
            root.frame = CGRect(origin: .zero, size: size)
            root.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(500))
            root.layoutSubtreeIfNeeded()
            let terminal = try XCTUnwrap(terminal(root))
            let frame = terminal.convert(terminal.bounds, to: root)
            XCTAssertGreaterThan(frame.height, 100)
            XCTAssertGreaterThanOrEqual(frame.minY, -1)
            XCTAssertLessThanOrEqual(frame.maxY, size.height + 1)
            XCTAssertGreaterThan(terminal.bounds.width, width - 10)
            XCTAssertTrue(String(decoding: terminal.getTerminal().getBufferAsData(), as: UTF8.self).contains("docked-system-shell-output"))
            let visible = try XCTUnwrap(actions.filter { $0.action == "viewport" }.map(viewport).last { $0["visible"] as? Bool == true })
            XCTAssertGreaterThan(try XCTUnwrap(visible["height"] as? Double), 150)
            if width == 1280 {
                let main = try XCTUnwrap(probe(root))
                XCTAssertGreaterThan(main.bounds.width, 439)
                XCTAssertLessThan(main.bounds.height, size.height - 150)
            }
            let image = await withCheckedContinuation { continuation in
                Snapshotting<NSView, NSImage>.image(size: size).snapshot(root).run { continuation.resume(returning: $0) }
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "terminal-browser-chat-dock-\(Int(width))"
            attachment.lifetime = .keepAlways
            add(attachment)
            model.workspaceState.restoreDock()
            root.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(300))
            XCTAssertEqual(model.workspaceState.selectedSurface, "terminal")
            XCTAssertNil(model.workspaceState.dockedSurface)
            model.invalidate()
        }
    }

    @MainActor private func terminal(_ view: NSView) -> TerminalView? {
        if let terminal = view as? TerminalView { return terminal }
        for child in view.subviews { if let found = terminal(child) { return found } }
        return nil
    }

    private func viewport(_ action: XgentAction) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(action.value.text.utf8)) as? [String: Any])
    }

    @MainActor private func probe(_ view: NSView) -> NSView? {
        if view.identifier?.rawValue == "workspace-main-probe" { return view }
        for child in view.subviews { if let found = probe(child) { return found } }
        return nil
    }

    private func panel(_ id: String, nodes: [[String: Any]]) throws -> XgentDocument {
        let data: [String: Any] = ["version": 1, "surface": id, "revision": 1, "mode": "panel",
                                 "title": id, "appearance": "light", "formFactor": "desktop", "nodes": nodes,
                                 "dismissAction": "close", "workspacePanel": ["focusRequest": 0,
                                 "openLabel": "Show panel", "returnLabel": "Return to chat",
                                 "expandLabel": "Expand", "restoreLabel": "Restore", "closeLabel": "Close panel"]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: data))
        try document.validate()
        return document
    }
}
#endif
