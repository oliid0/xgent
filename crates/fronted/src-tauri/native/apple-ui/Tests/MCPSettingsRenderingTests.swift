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

final class MCPSettingsRenderingTests: XCTestCase {
    @MainActor func testCompleteConnectionEditorAndServerRowAtNarrowAndLargeTextSizes() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 430, 768]
        #else
        let widths: [CGFloat] = [480, 1040]
        #endif
        for width in widths {
            for textSize in [DynamicTypeSize.large, .accessibility3] {
                for editor in [false, true] {
                    let document = try fixture(editor: editor)
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
                    let expected = editor ? "mcp-command" : "mcp-enabled"
                    let field = try XCTUnwrap(elements.first { $0.identifier == expected })
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
                    attachment.name = "mcp-\(editor ? "editor" : "server")-\(Int(width))-\(textSize)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    model.invalidate()
                }
            }
        }
    }

    private func fixture(editor: Bool) throws -> XgentDocument {
        func input(_ id: String, _ label: String, _ value: String) -> [String: Any] {
            ["id": id, "kind": "TextInput", "label": label, "value": value, "action": id]
        }
        let policy: [String: Any] = ["id": "mcp-policy", "kind": "SegmentedControl", "label": "工具权限", "value": "ask", "action": "policy",
            "options": [["value": "allow", "label": "允许"], ["value": "ask", "label": "每次询问"], ["value": "deny", "label": "禁止"]]]
        let actions: [[String: Any]] = [
            ["id": "mcp-enabled", "kind": "Switch", "label": "禁用", "value": true, "action": "enable"], policy,
            ["id": "mcp-edit", "kind": "IconButton", "label": "编辑", "icon": "pencil", "action": "edit"],
            ["id": "mcp-delete", "kind": "IconButton", "label": "删除", "icon": "trash", "destructive": true, "action": "delete"],
        ]
        let metadata: [String: Any] = ["id": "mcp-metadata", "kind": "VStack", "variant": "mcp-server-metadata", "children": [
            ["id": "tag-stdio", "kind": "Badge", "label": "STDIO"], ["id": "tag-args", "kind": "Badge", "label": "参数 2"],
            ["id": "tag-env", "kind": "Badge", "label": "环境变量 3"],
        ]]
        let row: [String: Any] = ["id": "mcp-server", "kind": "VStack", "variant": "mcp-server-row", "label": "工作空间文档 MCP 服务器", "children": [
            metadata, ["id": "mcp-preview", "kind": "Text", "text": "node /path with spaces/server.js --name=two words", "secondary": true],
            ["id": "mcp-actions", "kind": "VStack", "variant": "mcp-server-actions", "children": actions],
        ]]
        let form: [String: Any] = ["id": "mcp-form", "kind": "VStack", "variant": "mcp-server-editor", "fill": true, "children": [
            ["id": "title", "kind": "Heading", "text": "编辑 MCP 服务器"],
            ["id": "fields", "kind": "ScrollView", "fill": true, "children": [
                ["id": "general", "kind": "VStack", "variant": "mcp-connection-fields", "children": [
                    input("mcp-id", "服务器名称", "Documentation"),
                    ["id": "mcp-transport", "kind": "Selector", "label": "连接方式", "value": "stdio", "action": "transport",
                     "options": [["value": "stdio", "label": "STDIO"], ["value": "http", "label": "HTTP"], ["value": "sse", "label": "SSE"]]],
                    input("mcp-timeout", "超时 (毫秒)", "60000")]],
                ["id": "process", "kind": "VStack", "variant": "mcp-connection-fields", "children": [
                    input("mcp-command", "命令", "node"), input("mcp-cwd", "工作目录", "/path with spaces")]],
                ["id": "mcp-args", "kind": "TextArea", "language": "text", "label": "参数（每行一个）", "value": "/path with spaces/server.js\n--name=two words", "action": "args", "minHeight": 112],
                ["id": "mcp-env", "kind": "TextArea", "language": "text", "label": "环境变量", "value": "TOKEN=value\nLANG=zh_CN", "action": "env", "minHeight": 112],
            ]],
            ["id": "footer", "kind": "VStack", "variant": "mcp-editor-footer", "children": [
                ["id": "cancel", "kind": "Button", "label": "取消", "action": "cancel"],
                ["id": "save", "kind": "Button", "label": "保存", "action": "save", "prominent": true]]],
        ]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "mcp", "revision": 1, "mode": "root", "title": "MCP", "appearance": "light",
            "formFactor": factor, "nodes": [editor ? form : row]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
