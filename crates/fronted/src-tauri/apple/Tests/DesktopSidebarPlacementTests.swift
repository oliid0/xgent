#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class DesktopSidebarPlacementTests: XCTestCase {
    func testSidebarReservesUsableChatAndPanelWidthsInsteadOfSqueezingTheWindow() {
        func placement(_ width: CGFloat, panel: Bool = false, expanded: Bool = false,
                       stored: Double = 360, sidebar: Bool = true) -> XgentDesktopSidebarPlacement {
            XgentDesktopSidebarPlacement(availableWidth: width, storedWidth: stored,
                sidebarVisible: sidebar, panelVisible: panel, panelExpanded: expanded)
        }
        for width in [CGFloat(320), 640, 727] {
            let result = placement(width)
            XCTAssertFalse(result.inline)
            XCTAssertLessThanOrEqual(result.drawerWidth, width)
            XCTAssertEqual(result.minimumMainWidth, 440)
        }
        let twoPanes = placement(728)
        XCTAssertTrue(twoPanes.inline)
        XCTAssertEqual(twoPanes.columnWidth, 280)
        XCTAssertEqual(twoPanes.minimumMainWidth, 728)
        XCTAssertFalse(placement(1095, panel: true).inline)
        let threePanes = placement(1096, panel: true)
        XCTAssertTrue(threePanes.inline)
        XCTAssertEqual(threePanes.minimumMainWidth + 360 + 8, 1096)
        XCTAssertFalse(placement(1440, panel: true, expanded: true).inline)
        XCTAssertTrue(placement(1440, expanded: true).inline,
            "A retired panel's expanded flag must not cover an ordinary sidebar")
        XCTAssertFalse(placement(1440, sidebar: false).inline)
        XCTAssertEqual(placement(.infinity).drawerWidth, 0)
        XCTAssertFalse(placement(.nan).inline)
        XCTAssertEqual(placement(1440, stored: .nan).preferredWidth, 360)
        XCTAssertEqual(placement(1440, stored: -100).columnWidth, 280)
        XCTAssertEqual(placement(1440, stored: 10_000).columnWidth, 480)
    }

    func testNarrowingKeepsTheSavedPreferenceAndClampsOnlyTheLiveSidebarWidth() {
        let constrained = XgentDesktopSidebarPlacement(availableWidth: 760, storedWidth: 360,
            sidebarVisible: true, panelVisible: false, panelExpanded: false)
        XCTAssertEqual(constrained.columnWidth, 312)
        XCTAssertEqual(constrained.preferredWidth, 360)
        let wide = XgentDesktopSidebarPlacement(availableWidth: 1440, storedWidth: 360,
            sidebarVisible: true, panelVisible: false, panelExpanded: false)
        XCTAssertEqual(wide.columnWidth, 360)
        XCTAssertEqual(wide.preferredWidth, constrained.preferredWidth)
    }

    @MainActor func testActualSidebarControlsFitResizedWindowsAndBackdropUsesTheDismissBridge() async throws {
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        let key = "xgent.native.sidebar-width.v1"
        let previousWidth = UserDefaults.standard.object(forKey: key)
        defer {
            if let previousWidth { UserDefaults.standard.set(previousWidth, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        for panelMode in ["closed", "shown", "expanded"] {
            UserDefaults.standard.set(360, forKey: key)
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { action in
                actions.append(action)
                model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
            }
            model.update(try fixture("chat", mode: "root", nodes: [[
                "id": "chat", "kind": "ChatLayout", "value": "conversation:a", "fill": true,
                "children": [["id": "main-action", "kind": "Button", "label": "Conversation action",
                    "size": "large", "fill": true, "action": "main-action"]]
            ]]))
            if panelMode != "closed" {
                model.update(try fixture("terminal", mode: "panel", nodes: [[
                    "id": "panel-action", "kind": "Button", "label": "Running terminal session",
                    "size": "large", "fill": true, "action": "panel-action"
                ]]))
                model.workspaceState.expanded = panelMode == "expanded"
            }
            model.windowChromeInstalled = true
            let host = NSHostingView(rootView: XgentRootLayout(model: model)
                .environment(\.accessibilityEnabled, true)
                .transaction { $0.animation = nil; $0.disablesAnimations = true })
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 1440, height: 844),
                styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            var revision = 0
            for width in [CGFloat(1440), 1156, 760, 640, 320] {
                revision += 1
                model.update(try sidebar(revision: revision))
                window.setContentSize(CGSize(width: width, height: 844))
                host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(250))
                let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
                XCTAssertEqual(bounds.width, width, accuracy: 1,
                    "Content minimums must not force the host outside the requested window")
                let elements = nativeMacAccessibilityTree(host)
                let newChat = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "new-chat" })
                let search = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "sidebar-search-toggle" })
                let settings = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "settings" })
                for element in [newChat, search, settings] {
                    let frame = element.accessibilityFrame()
                    XCTAssertGreaterThan(frame.height, 20)
                    XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1)
                    XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
                    XCTAssertGreaterThanOrEqual(frame.minY, bounds.minY - 1)
                    XCTAssertLessThanOrEqual(frame.maxY, bounds.maxY + 1)
                }
                let name = "desktop-sidebar-\(panelMode)-\(Int(width))"
                try attachNativeAccessibilityEvidence(elements.map { [
                    "id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityLabel() ?? "",
                    "frame": NSStringFromRect($0.accessibilityFrame())
                ] }, name: name)
                if let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                    let image = NSImage(size: host.bounds.size); image.addRepresentation(bitmap)
                    let attachment = XCTAttachment(image: image); attachment.name = name
                    attachment.lifetime = .keepAlways; add(attachment)
                }
                let placement = XgentDesktopSidebarPlacement(availableWidth: width, storedWidth: 360,
                    sidebarVisible: true, panelVisible: panelMode != "closed", panelExpanded: panelMode == "expanded")
                if !placement.inline {
                    XCTAssertFalse(elements.contains { ["main-action", "panel-action"].contains($0.accessibilityIdentifier() ?? "") && $0.isAccessibilityEnabled() },
                        "A drawer must hide and disable the covered pane's controls")
                    XCTAssertTrue(settings.isAccessibilityEnabled())
                    let settingsFrame = settings.accessibilityFrame()
                    let screenPoint = NSPoint(x: settingsFrame.midX, y: settingsFrame.midY)
                    let hit = try XCTUnwrap(window.accessibilityHitTest(screenPoint) as? NSObject)
                    XCTAssertEqual(NativeMacAccessibilityElement(object: hit).accessibilityIdentifier(), "settings",
                        "The open drawer must expose its settings button to pointer hit testing")
                    let point = window.convertPoint(fromScreen: screenPoint)
                    let click = try [NSEvent.EventType.leftMouseDown, .leftMouseUp].enumerated().map { index, type in
                        try XCTUnwrap(NSEvent.mouseEvent(with: type, location: point,
                            modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                            windowNumber: window.windowNumber, context: nil, eventNumber: index + 1,
                            clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0))
                    }
                    let beforeClick = actions.count
                    NSApp.postEvent(click[1], atStart: true)
                    window.sendEvent(click[0])
                    if let release = NSApp.nextEvent(matching: .leftMouseUp, until: Date(), inMode: .default, dequeue: true) {
                        window.sendEvent(release)
                    }
                    try await Task.sleep(for: .milliseconds(100))
                    XCTAssertEqual(actions.count, beforeClick + 1)
                    XCTAssertEqual(actions.last?.action, "settings", "A real pointer click must open settings from the drawer")
                    let backdrop = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "xgent-sidebar-dismiss-backdrop" })
                    let count = actions.count
                    XCTAssertTrue(backdrop.accessibilityPerformPress())
                    try await Task.sleep(for: .milliseconds(50))
                    XCTAssertEqual(actions.count, count + 1)
                    XCTAssertEqual(actions.last?.surface, "sidebar")
                    XCTAssertEqual(actions.last?.action, "close")
                }
                revision += 1
                model.update(try sidebar(revision: revision, removed: true))
                host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(150))
                let current = nativeMacAccessibilityTree(host)
                let visibleAction = panelMode == "closed" ? "main-action" : "panel-action"
                let active = try XCTUnwrap(current.first { $0.accessibilityIdentifier() == visibleAction && $0.isAccessibilityEnabled() })
                let frame = active.accessibilityFrame()
                XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1)
                XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
                if panelMode != "closed" {
                    XCTAssertEqual(model.workspaceState.selectedSurface, "terminal")
                    XCTAssertTrue(model.workspaceState.visible, "Closing the drawer must preserve the running panel")
                }
            }
        }
    }

    @MainActor func testAcceptedConversationSelectionClosesOnlyTheDrawerAndStreamingDoesNotCloseIt() async throws {
        let session = try NativeMacAccessibilitySession()
        defer { session.restore() }
        for width in [CGFloat(320), 1440] {
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { action in
                actions.append(action)
                model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
            }
            func conversation(_ id: String, revision: Int) throws -> XgentDocument {
                try fixture("chat", mode: "root", revision: revision, nodes: [[
                    "id": "chat", "kind": "ChatLayout", "value": id, "fill": true,
                    "children": [["id": "transcript", "kind": "Text", "text": "Streaming response revision \(revision)"]]
                ]])
            }
            model.update(try conversation("conversation:a", revision: 1))
            model.update(try sidebar(revision: 1))
            model.windowChromeInstalled = true
            let host = NSHostingView(rootView: XgentRootLayout(model: model)
                .transaction { $0.animation = nil; $0.disablesAnimations = true })
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 844),
                styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(250))
            model.update(try conversation("conversation:a", revision: 2))
            host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(100))
            XCTAssertTrue(actions.isEmpty, "Output revisions must not dismiss an open sidebar")
            model.update(try conversation("conversation:b", revision: 3))
            host.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(150))
            if width == 320 {
                XCTAssertEqual(actions.count, 1)
                XCTAssertEqual(actions.first?.surface, "sidebar")
                XCTAssertEqual(actions.first?.action, "close")
            } else {
                XCTAssertTrue(actions.isEmpty, "Wide desktop navigation stays open after selecting a conversation")
            }
        }
    }

    private func sidebar(revision: Int, removed: Bool = false) throws -> XgentDocument {
        try fixture("sidebar", mode: "sidebar", revision: revision, removed: removed, nodes: [[
            "id": "sidebar-layout", "kind": "VStack", "children": [
                ["id": "sidebar-title", "kind": "Heading", "text": "XGent"],
                ["id": "sidebar-close", "kind": "IconButton", "label": "Close sidebar", "action": "close"],
                ["id": "sidebar-search-toggle", "kind": "IconButton", "label": "Search workspace", "action": "search"],
                ["id": "sidebar-list", "kind": "List", "children": [
                    ["id": "skills", "kind": "NavigationRow", "label": "Skills", "action": "skills"],
                    ["id": "recents-label", "kind": "Heading", "text": "Recent conversations"]]],
                ["id": "sidebar-footer", "kind": "HStack", "children": [
                    ["id": "new-chat", "kind": "Button", "label": "New conversation", "action": "new-chat"],
                    ["id": "settings", "kind": "IconButton", "label": "Settings", "icon": "gearshape", "size": "large", "action": "settings"]]]
            ]
        ]])
    }

    private func fixture(_ surface: String, mode: String, revision: Int = 1,
                         removed: Bool = false, nodes: [[String: Any]]) throws -> XgentDocument {
        var payload: [String: Any] = ["version": 1, "surface": surface, "revision": revision,
            "mode": mode, "title": surface, "appearance": "light", "formFactor": "desktop",
            "nodes": removed ? [] : nodes, "removed": removed]
        if mode != "root" { payload["dismissAction"] = "close" }
        if mode == "panel" {
            payload["workspacePanel"] = ["focusRequest": 0, "openLabel": "Show panel", "returnLabel": "Return to chat",
                "expandLabel": "Expand panel", "restoreLabel": "Restore", "closeLabel": "Hide panel"]
        }
        let document = try JSONDecoder().decode(XgentDocument.self,
            from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
#endif
