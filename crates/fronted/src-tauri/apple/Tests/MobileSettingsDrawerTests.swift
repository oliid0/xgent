#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileSettingsDrawerTests: XCTestCase {
    @MainActor
    func testSidebarFooterKeepsIdentifiedActionsVisibleBelowLongHistory() async throws {
        let model = XgentPresentationModel()
        model.update(try document(surface: "chat", mode: "root", title: "Chat", nodes: [
            node("conversation", "Text", ["text": "Conversation"]),
        ]))
        let host = UIHostingController(rootView: XgentPresentationView(model: model)
            .dynamicTypeSize(.accessibility2))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 844))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        let history = (0..<40).map { index in
            node("conversation:\(index)", "NavigationRow", ["label": "Recent conversation \(index)",
                "variant": "sidebar-conversation", "action": "open:\(index)"])
        }
        model.update(try document(surface: "sidebar", mode: "sidebar", title: "Xgent", nodes: [
            node("sidebar-layout", "VStack", ["children": [
                node("sidebar-title", "Heading", ["text": "Xgent"]),
                node("sidebar-list", "List", ["children": history]),
                node("sidebar-footer", "HStack", ["children": [
                    node("new-chat", "Button", ["label": "New chat", "action": "new"]),
                    node("settings", "IconButton", ["label": "Settings", "icon": "gearshape", "action": "settings"]),
                    node("sidebar-update", "IconButton", ["label": "Update to version 1.2.3", "variant": "sidebar-update", "icon": "arrow.down", "action": "update"]),
                ]]),
            ]]),
        ]))
        try await waitFor("settings", in: window)
        host.view.layoutIfNeeded()
        let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: window)
        let elements = hierarchy.flattenToElements()
        let settings = try XCTUnwrap(elements.first { $0.identifier == "settings" && $0.traits.contains(.button) })
        let newChat = try XCTUnwrap(elements.first { $0.identifier == "new-chat" && $0.traits.contains(.button) })
        let update = try XCTUnwrap(elements.first { $0.identifier == "sidebar-update" && $0.traits.contains(.button) })
        for action in [settings, newChat, update] {
            let bounds = action.shape.bezierPath.bounds
            XCTAssertGreaterThanOrEqual(bounds.height, 44)
            XCTAssertGreaterThanOrEqual(bounds.minX, -1)
            XCTAssertGreaterThanOrEqual(bounds.minY, -1)
            XCTAssertLessThanOrEqual(bounds.maxX, 320 * 0.85 + 1)
            XCTAssertLessThanOrEqual(bounds.maxY, 845)
        }
        XCTAssertFalse(settings.shape.bezierPath.bounds.intersects(newChat.shape.bezierPath.bounds))
        XCTAssertFalse(update.shape.bezierPath.bounds.intersects(newChat.shape.bezierPath.bounds))
        XCTAssertFalse(update.shape.bezierPath.bounds.intersects(settings.shape.bezierPath.bounds))
        try attachNativeAccessibilityEvidence(hierarchy, name: "sidebar-footer-long-history-320-accessible")
        try attachCompositedNativeScreenshot(of: window, name: "sidebar-footer-long-history-320-accessible")
    }

    @MainActor
    func testMountedSettingsIndexStartsWithSectionsAndKeepsDetailNavigation() async throws {
        for (width, size) in [(CGFloat(320), DynamicTypeSize.large), (390, .large), (320, .accessibility3)] {
            let model = XgentPresentationModel()
            model.update(try document(surface: "chat", mode: "root", title: "Chat", nodes: [
                node("conversation", "Text", ["text": "Conversation"]),
            ]))
            let host = UIHostingController(rootView: XgentPresentationView(model: model).dynamicTypeSize(size))
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
            window.rootViewController = host
            window.makeKeyAndVisible()
            defer { host.dismiss(animated: false); model.invalidate(); window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 100_000_000)
            model.update(try document(nodes: indexNodes))
            try await waitFor("theme", in: window)
            try await Task.sleep(nanoseconds: 250_000_000)
            let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: window)
            let elements = hierarchy.flattenToElements()
            XCTAssertFalse(elements.contains { $0.identifier == "presentation-sheet-title" },
                "The index must have no separate Settings title")
            let close = try XCTUnwrap(elements.first { $0.identifier == "presentation-sheet-close" })
            let appearance = try XCTUnwrap(elements.first { $0.identifier == "theme" && $0.traits.contains(.button) })
            XCTAssertEqual(appearance.value, "System")
            let general = try XCTUnwrap(elements.first { $0.identifier == "nav:system" && $0.traits.contains(.button) })
            XCTAssertEqual(general.label, "General")
            XCTAssertEqual(general.value, "English")
            let generalBounds = general.shape.bezierPath.bounds
            XCTAssertGreaterThanOrEqual(generalBounds.height, 44)
            XCTAssertGreaterThanOrEqual(generalBounds.minX, -1)
            XCTAssertLessThanOrEqual(generalBounds.maxX, width + 1)
            XCTAssertFalse(elements.contains { $0.label == "Language, appearance and detailed interface preferences" },
                "Index descriptions remain hints rather than adding a second visible line")
            let closeBounds = close.shape.bezierPath.bounds
            XCTAssertGreaterThanOrEqual(closeBounds.height, 44)
            XCTAssertGreaterThanOrEqual(closeBounds.minX, -1)
            XCTAssertLessThanOrEqual(closeBounds.maxX, width + 1)
            XCTAssertFalse(closeBounds.intersects(appearance.shape.bezierPath.bounds),
                "The close control must leave the first setting unobstructed")
            let name = "settings-index-drawer-\(Int(width))-\(size)"
            try attachNativeAccessibilityEvidence(hierarchy, name: name)
            try attachCompositedNativeScreenshot(of: window, name: name)

            let scroll = try XCTUnwrap(scrollViews(in: window).first {
                $0.contentSize.height > $0.bounds.height + 44
            }, "The full settings index needs a scrollable list")
            for _ in 0..<2 {
                scroll.setContentOffset(CGPoint(x: 0,
                    y: max(0, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)),
                    animated: false)
                try await Task.sleep(nanoseconds: 150_000_000)
                window.layoutIfNeeded()
            }
            let scrolled = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: window)
            let scrolledElements = scrolled.flattenToElements()
            let scrolledClose = try XCTUnwrap(scrolledElements.first { $0.identifier == "presentation-sheet-close" })
            XCTAssertEqual(scrolledClose.shape.bezierPath.bounds.minY, closeBounds.minY, accuracy: 1,
                "Closing settings must remain reachable while the index scrolls")
            let about = try XCTUnwrap(scrolledElements.first { $0.identifier == "nav:about" && $0.traits.contains(.button) })
            XCTAssertGreaterThanOrEqual(about.shape.bezierPath.bounds.minY, 0)
            XCTAssertLessThanOrEqual(about.shape.bezierPath.bounds.maxY, window.bounds.height + 1)
            try attachNativeAccessibilityEvidence(scrolled, name: "\(name)-scrolled")
            try attachCompositedNativeScreenshot(of: window, name: "\(name)-scrolled")

            // Use the same live surface as production routing: removing the
            // index section and adding Back must restore the detail header.
            model.update(try document(title: "General", revision: 2, nodes: [
                node("back", "Button", ["label": "Back", "action": "back"]),
                node("save-status", "Text", ["text": "Saved", "secondary": true]),
                node("system-settings", "SettingsGroup", ["label": "App", "children": [
                    node("language", "Selector", ["label": "App language", "value": "en", "action": "language",
                        "options": [["value": "en", "label": "English"]]]),
                ]]),
            ]))
            try await waitFor("presentation-sheet-title", in: window)
            let detail = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: window)
            let detailElements = detail.flattenToElements()
            let title = try XCTUnwrap(detailElements.first { $0.identifier == "presentation-sheet-title" })
            let back = try XCTUnwrap(detailElements.first { $0.identifier == "back" && $0.traits.contains(.button) })
            XCTAssertEqual(title.label, "General")
            XCTAssertFalse(detailElements.contains { $0.identifier == "save-status" },
                "Successful automatic saves must not occupy the settings header")
            XCTAssertFalse(detailElements.contains { $0.identifier == "presentation-sheet-close" },
                "The detail header needs one Back control and a centered title")
            XCTAssertGreaterThanOrEqual(back.shape.bezierPath.bounds.height, 44)
            XCTAssertFalse(title.shape.bezierPath.bounds.intersects(back.shape.bezierPath.bounds))
            try attachNativeAccessibilityEvidence(detail, name: "\(name)-detail")
            try attachCompositedNativeScreenshot(of: window, name: "\(name)-detail")
            model.update(try document(title: "General", revision: 3, nodes: [
                node("back", "Button", ["label": "Back", "action": "back"]),
                node("save-status", "Text", ["text": "Could not save settings", "secondary": false]),
                node("system-settings", "SettingsGroup", ["label": "App", "children": [
                    node("notifications", "Switch", ["label": "Push", "value": true, "action": "notifications"]),
                ]]),
            ]))
            try await waitFor("save-status", in: window)
            let failed = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: window).flattenToElements()
            let failure = try XCTUnwrap(failed.first { $0.identifier == "save-status" })
            XCTAssertEqual(failure.label, "Could not save settings")
            let failureTitle = try XCTUnwrap(failed.first { $0.identifier == "presentation-sheet-title" })
            XCTAssertFalse(failure.shape.bezierPath.bounds.intersects(failureTitle.shape.bezierPath.bounds))
            model.update(try document(title: "General", revision: 4, nodes: [
                node("back", "IconButton", ["label": "Back", "action": "back", "disabled": true]),
                node("saving", "Progress", ["label": "Saving"]),
            ]))
            try await waitFor("saving", in: window)
            let saving = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: window).flattenToElements()
            let disabledBack = try XCTUnwrap(saving.first { $0.identifier == "back" && $0.traits.contains(.button) })
            XCTAssertTrue(disabledBack.traits.contains(.notEnabled), "Saving must expose a genuinely disabled Back control")
        }
    }

    @MainActor private func waitFor(_ id: String, in view: UIView) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while ContinuousClock.now < deadline {
            let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: view).flattenToElements()
            if elements.contains(where: { $0.identifier == id }) { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("The mounted native drawer did not show \(id)")
    }

    @MainActor private func scrollViews(in view: UIView) -> [UIScrollView] {
        let current = (view as? UIScrollView).map { [$0] } ?? []
        return current + view.subviews.flatMap { scrollViews(in: $0) }
    }

    private var indexNodes: [[String: Any]] {
        [node("mobile-theme", "SettingsGroup", ["label": "", "children": [
            node("theme", "Selector", ["label": "Appearance", "icon": "sun.max", "value": "system", "action": "theme",
                "options": [["value": "system", "label": "System"], ["value": "dark", "label": "Dark"]]]),
            node("appearance-preset", "Selector", ["label": "Theme preset", "icon": "paintpalette", "value": "current", "action": "preset",
                "options": [["value": "current", "label": "Current theme"]]]),
        ]]), node("mobile-appearance", "SettingsGroup", ["label": "App settings", "children": [
            node("nav:system", "NavigationRow", ["label": "General", "icon": "gearshape", "action": "general",
                "variant": "settings-index-navigation", "value": "English", "text": "Language, appearance and detailed interface preferences"]),
            node("nav:providers", "NavigationRow", ["label": "Providers", "icon": "cpu", "action": "providers",
                "variant": "settings-index-navigation", "value": "5 providers"]),
        ]]), node("mobile-personal", "SettingsGroup", ["label": "Personalization", "children": [
            node("nav:soul", "NavigationRow", ["label": "Soul", "icon": "sparkles", "action": "soul", "variant": "settings-index-navigation"]),
            node("nav:memory", "NavigationRow", ["label": "Memory", "icon": "brain", "action": "memory", "variant": "settings-index-navigation"]),
            node("nav:mobileAssistant", "NavigationRow", ["label": "Personal Assistant", "icon": "shield", "action": "assistant", "variant": "settings-index-navigation"]),
        ]]), node("mobile-capabilities", "SettingsGroup", ["label": "Capabilities and connections", "children": [
            node("nav:mobileExecution", "NavigationRow", ["label": "Shell Management", "icon": "terminal", "action": "shell", "variant": "settings-index-navigation"]),
            node("nav:toolPermissions", "NavigationRow", ["label": "Tool Permissions", "icon": "lock.shield", "action": "permissions", "variant": "settings-index-navigation", "value": "Default"]),
            node("nav:voice", "NavigationRow", ["label": "Voice Input", "icon": "mic", "action": "voice", "variant": "settings-index-navigation", "value": "Off"]),
            node("nav:other", "NavigationRow", ["label": "Other", "icon": "ellipsis", "action": "other", "variant": "settings-index-navigation"]),
            node("nav:access", "NavigationRow", ["label": "Local & Cloud", "icon": "icloud", "action": "access", "variant": "settings-index-navigation", "value": "Local"]),
            node("nav:backup", "NavigationRow", ["label": "Backup & Sync", "icon": "archivebox", "action": "backup", "variant": "settings-index-navigation"]),
            node("nav:about", "NavigationRow", ["label": "About", "icon": "info.circle", "action": "about", "variant": "settings-index-navigation", "value": "v1.0"]),
        ]])]
    }

    private func node(_ id: String, _ kind: String, _ fields: [String: Any] = [:]) -> [String: Any] {
        fields.merging(["id": id, "kind": kind]) { _, value in value }
    }

    private func document(surface: String = "settings:real-session-uuid", mode: String = "sheet", title: String = "Settings",
                          revision: Int = 1, nodes: [[String: Any]]) throws -> XgentDocument {
        let payload: [String: Any] = ["version": 1, "surface": surface, "revision": revision, "mode": mode,
            "title": title, "formFactor": "mobile", "appearance": "light", "dismissAction": "close", "nodes": nodes]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
#endif
