#if os(macOS)
import AppKit
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class ComputerUsePermissionTests: XCTestCase {
    @MainActor func testNativeForegroundRefreshAndPermissionButtonsSendTheSharedActions() async throws {
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        let document = try fixture()
        let model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []
        model.actionSink = { action in
            actions.append(action)
            model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
        }
        let card = try XCTUnwrap(document.node(id: "computer-use-permissions"))
        let host = NSHostingView(rootView: XgentNodeView(node: card, document: document, model: model)
            .environment(\.accessibilityEnabled, true)
            .padding(20).frame(width: 640)
            .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light)))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 600),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(nanoseconds: 200_000_000)
        host.layoutSubtreeIfNeeded()
        NotificationCenter.default.post(name: NSApplication.didBecomeActiveNotification, object: NSApp)
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertTrue(actions.contains { $0.action == "refresh" })
        let elements = accessibility(host)
        try attachNativeAccessibilityEvidence(elements.map { ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityLabel() ?? ""] },
            name: "computer-permissions-accessibility")
        let accessibilityRequest = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "accessibility-request" })
        XCTAssertTrue(accessibilityRequest.accessibilityPerformPress())
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(actions.last?.action, "accessibility")
        let grantedRequest = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "screen-request" })
        XCTAssertFalse(grantedRequest.isAccessibilityEnabled())
        let before = actions.count
        model.invalidate()
        NotificationCenter.default.post(name: NSApplication.didBecomeActiveNotification, object: NSApp)
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(actions.count, before)
    }

    @MainActor func testPermissionRowsWrapAtNarrowWidthsAndLargeText() async throws {
        for width: CGFloat in [480, 1040] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel()
                model.update(document)
                let card = try XCTUnwrap(document.node(id: "computer-use-permissions"))
                let content = ScrollView {
                    XgentNodeView(node: card, document: document, model: model).padding(20)
                }.dynamicTypeSize(size).frame(width: width, height: 740)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .dark))
                let host = NSHostingView(rootView: content)
                host.frame = CGRect(x: 0, y: 0, width: width, height: 740)
                host.layoutSubtreeIfNeeded()
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 740))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 1000)
                let attachment = XCTAttachment(image: image)
                attachment.name = "computer-permissions-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
                model.invalidate()
            }
        }
    }

    @MainActor private func accessibility(_ root: Any) -> [any NSAccessibilityProtocol] {
        var result: [any NSAccessibilityProtocol] = []
        var seen = Set<ObjectIdentifier>()
        func visit(_ value: Any) {
            guard let object = value as? NSObject, seen.insert(ObjectIdentifier(object)).inserted else { return }
            if let element = value as? any NSAccessibilityProtocol {
                result.append(element)
                for child in element.accessibilityChildren() ?? [] { visit(child) }
            }
            if let view = value as? NSView { for child in view.subviews { visit(child) } }
        }
        visit(root)
        return result
    }

    private func fixture() throws -> XgentDocument {
        let permissions: [[String: Any]] = [
            ["id": "accessibility-row", "kind": "VStack", "variant": "computer-use-permission",
             "label": "辅助功能权限 · Accessibility", "text": "允许智能体读取并操作电脑上的应用程序。Authorize application controls for the shared computer-use driver.",
             "children": [
                ["id": "accessibility-status", "kind": "Badge", "label": "未授权", "status": "pending"],
                ["id": "accessibility-request", "kind": "Button", "label": "请求权限", "action": "accessibility"],
             ]],
            ["id": "screen-row", "kind": "VStack", "variant": "computer-use-permission",
             "label": "屏幕录制权限", "text": "读取电脑当前画面，以确认执行结果。",
             "children": [
                ["id": "screen-status", "kind": "Badge", "label": "已授权", "status": "completed"],
                ["id": "screen-request", "kind": "Button", "label": "请求权限", "action": "screen", "disabled": true],
             ]],
        ]
        let payload: [String: Any] = ["version": 1, "surface": "permissions", "revision": 1, "mode": "sheet",
            "title": "Computer use", "appearance": "light", "formFactor": "desktop", "nodes": [
                ["id": "computer-use-permissions", "kind": "SettingsGroup", "label": "系统授权", "children": permissions],
                ["id": "computer-use-refresh", "kind": "Button", "label": "刷新状态", "action": "refresh"],
            ]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
#endif
