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
                    defer { window.isHidden = true; window.rootViewController = nil }
                    host.view.layoutIfNeeded()
                    try await Task.sleep(nanoseconds: 150_000_000)
                    let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view).flattenToElements()
                    let field = try XCTUnwrap(elements.first { $0.identifier == (preview ? "preview-close" : "skill-enabled") })
                    XCTAssertLessThanOrEqual(field.shape.bezierPath.bounds.maxX, width + 1)
                    XCTAssertGreaterThanOrEqual(field.shape.bezierPath.bounds.minX, -1)
                    let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 920))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                    }
                    #else
                    let host = NSHostingView(rootView: content)
                    host.frame = CGRect(x: 0, y: 0, width: width, height: 920)
                    host.layoutSubtreeIfNeeded()
                    XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                    let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 920))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(host).run { continuation.resume(returning: $0) }
                    }
                    #endif
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "skills-\(preview ? "preview" : "installed")-\(Int(width))-\(textSize)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
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
            ["id": "description", "kind": "VStack", "variant": "skill-detail-value", "label": "说明", "text": "搜索资料、检查来源，然后编写文稿和表格。"],
            ["id": "content", "kind": "Markdown", "text": "## 工作步骤\n\n- 搜索资料\n- 制作表格\n\n```swift\nlet result = 42\n```"],
            ["id": "truncated", "kind": "Banner", "status": "paused", "label": "文件内容已截断，只显示前 10000 个字符。"],
        ]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let layout: [String: Any] = ["id": "layout", "kind": "VStack", "variant": "skills-hub-layout", "fill": true, "children": preview ? [main, detail] : [main]]
        let payload: [String: Any] = ["version": 1, "surface": "skills", "revision": 1, "mode": "root", "title": "Skills", "formFactor": factor, "nodes": [layout]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
