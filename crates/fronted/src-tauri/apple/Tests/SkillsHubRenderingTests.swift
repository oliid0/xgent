import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class SkillsHubRenderingTests: XCTestCase {
    @MainActor func testInstalledAndPreviewLayoutsAtNarrowAndLargeTextSizes() async throws {
        #if os(macOS)
        let accessibility = try NativeMacAccessibilitySession(); defer { accessibility.restore() }
        #endif
        #if os(iOS)
        let widths: [CGFloat] = [320, 430]
        #else
        let widths: [CGFloat] = [480, 1040]
        #endif
        for width in widths {
            for textSize in [DynamicTypeSize.large, .accessibility3] {
                for preview in [false, true] {
                    let document = try fixture(preview: preview)
                    let model = XgentPresentationModel()
                    model.update(document)
                    var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
                    let content = VStack {
                        #if os(iOS)
                        XgentIOSNodes(nodes: document.nodes, document: document, model: model)
                        #else
                        ForEach(document.nodes) { XgentNodeView(node: $0, document: document, model: model) }
                        #endif
                    }.frame(width: width, height: 920).dynamicTypeSize(textSize)
                        .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                    #if os(iOS)
                    let host = UIHostingController(rootView: content)
                    host.safeAreaRegions = []
                    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 920))
                    window.rootViewController = host
                    window.makeKeyAndVisible()
                    defer { host.dismiss(animated: false); model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                    host.view.layoutIfNeeded()
                    try await Task.sleep(nanoseconds: 150_000_000)
                    if preview {
                        for _ in 0..<20 {
                            if let presented = host.presentedViewController, !presented.isBeingPresented { break }
                            try await Task.sleep(nanoseconds: 100_000_000)
                        }
                        let presented = try XCTUnwrap(host.presentedViewController)
                        XCTAssertFalse(presented.isBeingPresented, "Capture the completed sheet presentation")
                    }
                    // A native sheet is presented beside the hosting view.
                    // Inspect the window so the real preview controls are
                    // included, as they are for the user and VoiceOver.
                    let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: window)
                    let elements = hierarchy.flattenToElements()
                    let field = try XCTUnwrap(elements.first { $0.identifier == (preview ? "preview-close" : "skill-enabled") })
                    XCTAssertLessThanOrEqual(field.shape.bezierPath.bounds.maxX, width + 1)
                    XCTAssertGreaterThanOrEqual(field.shape.bezierPath.bounds.minX, -1)
                    if preview {
                        let footer = try XCTUnwrap(elements.first { $0.identifier == "preview-copy" && $0.traits.contains(.button) })
                        let rect = footer.shape.bezierPath.bounds
                        XCTAssertGreaterThanOrEqual(rect.height, 43.5)
                        XCTAssertGreaterThanOrEqual(rect.minX, -1)
                        XCTAssertGreaterThanOrEqual(rect.minY, -1)
                        XCTAssertLessThanOrEqual(rect.maxX, width + 1)
                        XCTAssertLessThanOrEqual(rect.maxY, 921)
                        XCTAssertFalse(rect.intersects(field.shape.bezierPath.bounds))
                        XCTAssertTrue(elements.contains { $0.identifier == "preview-enable" }, "The real native selection switch must remain reachable")
                    }
                    let name = "skills-\(preview ? "preview" : "installed")-\(Int(width))-\(textSize)"
                    try attachNativeAccessibilityEvidence(hierarchy, name: name)
                    // SnapshotTesting's UIView strategy reparents its input.
                    // A mounted UIWindow must be captured in place instead.
                    try attachCompositedNativeScreenshot(of: window, name: name)
                    if preview {
                        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                            host.dismiss(animated: false) { continuation.resume() }
                        }
                    }
                    #else
                    let host = NSHostingView(rootView: content)
                    let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 920),
                                          styleMask: [.titled], backing: .buffered, defer: false)
                    window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                    defer {
                        if let sheet = window.attachedSheet { window.endSheet(sheet) }
                        model.invalidate(); window.close()
                    }
                    host.layoutSubtreeIfNeeded()
                    try await Task.sleep(nanoseconds: 150_000_000)
                    if preview {
                        for _ in 0..<20 {
                            if let sheet = window.attachedSheet,
                               nativeMacAccessibilityTree(sheet).contains(where: { $0.accessibilityIdentifier() == "preview-close" }) { break }
                            try await Task.sleep(nanoseconds: 100_000_000)
                        }
                    }
                    let visibleWindow: NSWindow
                    if preview { visibleWindow = try XCTUnwrap(window.attachedSheet) } else { visibleWindow = window }
                    let visibleView = try XCTUnwrap(visibleWindow.contentView)
                    let field = try XCTUnwrap(nativeMacAccessibilityTree(visibleWindow).first {
                        $0.accessibilityIdentifier() == (preview ? "preview-close" : "skill-enabled")
                    })
                    let bounds = visibleWindow.convertToScreen(visibleView.convert(visibleView.bounds, to: nil))
                    try attachNativeAccessibilityEvidence([
                        "window": NSStringFromRect(visibleWindow.frame), "content": NSStringFromRect(bounds),
                        "elements": nativeMacAccessibilityTree(visibleWindow).map {
                            ["id": $0.accessibilityIdentifier() ?? "", "role": $0.accessibilityRole()?.rawValue ?? "",
                             "text": $0.accessibilityText() ?? "", "frame": NSStringFromRect($0.accessibilityFrame())]
                        }.description
                    ], name: "skills-\(preview ? "preview" : "installed")-\(Int(width))-\(textSize)-accessibility")
                    XCTAssertGreaterThanOrEqual(field.accessibilityFrame().minX, bounds.minX - 1)
                    XCTAssertLessThanOrEqual(field.accessibilityFrame().maxX, bounds.maxX + 1)
                    if preview {
                        XCTAssertGreaterThanOrEqual(field.accessibilityFrame().minY, bounds.minY - 1)
                        XCTAssertLessThanOrEqual(field.accessibilityFrame().maxY, bounds.maxY + 1,
                                                 "The fixed header must remain inside a screen-constrained sheet")
                        let elements = nativeMacAccessibilityTree(visibleWindow)
                        let footer = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "preview-copy" && $0.accessibilityRole() == .button })
                        let frame = footer.accessibilityFrame()
                        XCTAssertGreaterThanOrEqual(frame.height, 31.5)
                        XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1)
                        XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
                        XCTAssertGreaterThanOrEqual(frame.minY, bounds.minY - 1)
                        XCTAssertLessThanOrEqual(frame.maxY, bounds.maxY + 1)
                        XCTAssertFalse(frame.intersects(field.accessibilityFrame()))
                        XCTAssertTrue(footer.accessibilityPerformPress())
                        XCTAssertEqual(actions.last?.action, "copy")
                        XCTAssertTrue(elements.contains { $0.accessibilityIdentifier() == "preview-enable" })
                        XCTAssertLessThanOrEqual(bounds.width, 705, "Extension previews must not occupy settings-dialog width")
                    }
                    XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                    let strategy = Snapshotting<NSView, NSImage>.image(size: visibleView.bounds.size)
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(visibleView).run { continuation.resume(returning: $0) }
                    }
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "skills-\(preview ? "preview" : "installed")-\(Int(width))-\(textSize)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    if preview {
                        XCTAssertTrue(field.accessibilityPerformPress())
                        XCTAssertEqual(actions.last?.action, "close")
                    }
                    #endif
                    model.invalidate()
                }
            }
        }
    }

    private func fixture(preview: Bool) throws -> XgentDocument {
        let row: [String: Any] = ["id": "skill", "kind": "VStack", "variant": "skill-installed-row", "label": "Research assistant", "children": [
            ["id": "skill-title", "kind": "Button", "label": "研究与文档制作助手", "action": "preview", "variant": "ghost"],
            ["id": "skill-description", "kind": "Text", "text": "搜索资料、核对来源，然后编写文稿和表格；包含脚本与本地资源。", "secondary": true],
            ["id": "tags", "kind": "VStack", "variant": "skill-tags", "children": [
                ["id": "research", "kind": "Badge", "label": "研究"], ["id": "development", "kind": "Badge", "label": "开发工具"]]],
            ["id": "actions", "kind": "VStack", "variant": "skill-row-actions", "children": [
                ["id": "skill-enabled", "kind": "Switch", "label": "启用研究助手", "value": true, "action": "enable"],
                ["id": "skill-bulk:bulk", "kind": "Switch", "label": "选择研究助手", "value": false, "action": "select"],
                ["id": "delete", "kind": "IconButton", "label": "删除技能", "icon": "trash", "action": "delete", "destructive": true]]],
        ]]
        let main: [String: Any] = ["id": "main", "kind": "VStack", "variant": "skills-hub-main", "fill": true, "children": [
            ["id": "toolbar", "kind": "VStack", "variant": "skills-hub-toolbar", "children": [
                ["id": "title", "kind": "Heading", "text": "技能管理"],
                ["id": "global-enabled", "kind": "Switch", "label": "启用", "value": true, "action": "enable-all"],
                ["id": "refresh", "kind": "Button", "label": "重新扫描", "action": "refresh"]]],
            ["id": "controls", "kind": "VStack", "variant": "skill-hub-controls", "children": [
                ["id": "query", "kind": "TextInput", "label": "搜索技能", "value": "", "action": "query"],
                ["id": "sort", "kind": "Selector", "label": "排序", "value": "name", "action": "sort", "options": [["value": "name", "label": "名称 A→Z"]]]]],
            ["id": "list", "kind": "ScrollView", "fill": true, "children": [row]],
        ]]
        let detail: [String: Any] = ["id": "preview", "kind": "VStack", "variant": "skill-preview", "children": [
            ["id": "preview-close", "kind": "IconButton", "label": "关闭预览", "icon": "xmark", "action": "close"],
            ["id": "preview-title", "kind": "Heading", "text": "研究与文档制作助手"],
            ["id": "preview-controls", "kind": "HStack", "variant": "extension-preview-controls", "children": [
                ["id": "preview-enable", "kind": "Switch", "label": "启用研究与文档制作助手", "value": true, "action": "preview-enable"]]],
            ["id": "preview-body", "kind": "VStack", "variant": "extension-preview-body", "children": [
                ["id": "description", "kind": "Text", "text": "搜索资料、检查来源，然后编写文稿和表格。"],
                ["id": "content", "kind": "Markdown", "text": String(repeating: "## 工作步骤\n\n- 搜索资料\n- 制作表格\n\n```swift\nlet result = 42\n```\n\n", count: 40)],
                ["id": "truncated", "kind": "Banner", "status": "paused", "label": "文件内容已截断，只显示前 10000 个字符。"],
                ["id": "preview-details", "kind": "Collapsible", "label": "详细信息", "children": [
                    ["id": "preview-path", "kind": "Text", "text": "/workspace/skills/research/SKILL.md"]]]]],
            ["id": "preview-footer", "kind": "HStack", "variant": "extension-preview-footer", "children": [
                ["id": "preview-copy", "kind": "Button", "label": "复制文件内容", "action": "copy"]]],
        ]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let layout: [String: Any] = ["id": "layout", "kind": "VStack", "variant": "skills-hub-layout", "fill": true, "children": preview ? [main, detail] : [main]]
        let payload: [String: Any] = ["version": 1, "surface": "skills", "revision": 1, "mode": "root", "title": "Skills", "appearance": "light", "formFactor": factor, "nodes": [layout]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
