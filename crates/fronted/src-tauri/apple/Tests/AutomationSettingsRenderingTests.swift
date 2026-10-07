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

final class AutomationSettingsRenderingTests: XCTestCase {
    @MainActor func testHTTPAndAutomationSettingsRenderWithoutHorizontalOverflow() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 430, 768]
        #else
        let widths: [CGFloat] = [480, 1040]
        #endif
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                for expanded in [false, true] {
                    let document = try fixture(expanded: expanded)
                    let model = XgentPresentationModel()
                    model.update(document)
                    let content = ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            #if os(iOS)
                            XgentIOSNodes(nodes: document.nodes, document: document, model: model)
                            #else
                            ForEach(document.nodes) { XgentNodeView(node: $0, document: document, model: model) }
                            #endif
                        }.padding(16)
                    }.dynamicTypeSize(size).frame(width: width, height: 860)
                        .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                    #if os(iOS)
                    let host = UIHostingController(rootView: content)
                    host.safeAreaRegions = []
                    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 860))
                    window.rootViewController = host
                    window.makeKeyAndVisible()
                    defer { window.isHidden = true; window.rootViewController = nil }
                    host.view.layoutIfNeeded()
                    try await Task.sleep(nanoseconds: 200_000_000)
                    let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                    try attachNativeAccessibilityEvidence(hierarchy, name: "automation-accessibility-\(Int(width))-\(size)-\(expanded)")
                    let elements = hierarchy.flattenToElements()
                    for id in ["http:expand", "http:remove"] {
                        let element = try XCTUnwrap(elements.first { $0.identifier == id && $0.traits.contains(.button) })
                        let rect = element.shape.bezierPath.bounds
                        XCTAssertGreaterThanOrEqual(rect.height, 43.5)
                        XCTAssertGreaterThanOrEqual(rect.minX, -1)
                        XCTAssertLessThanOrEqual(rect.maxX, width + 1)
                    }
                    let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 860))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                    }
                    #else
                    let host = NSHostingView(rootView: content)
                    host.frame = CGRect(x: 0, y: 0, width: width, height: 860)
                    host.layoutSubtreeIfNeeded()
                    XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                    let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 860))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(host).run { continuation.resume(returning: $0) }
                    }
                    #endif
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "automation-settings-\(Int(width))-\(size)-\(expanded ? "expanded" : "collapsed")"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    model.invalidate()
                }
            }
        }
    }

    private func fixture(expanded: Bool) throws -> XgentDocument {
        let address: [String: Any] = ["id": "http:address", "kind": "VStack", "variant": "http-request-address", "children": [
            ["id": "http:url", "kind": "TextInput", "label": "请求网址 · URL", "value": "https://example.com/hook", "action": "url"],
            ["id": "http:method", "kind": "Selector", "label": "请求方法", "value": "POST", "action": "method",
             "options": [["value": "GET", "label": "GET"], ["value": "POST", "label": "POST"]]],
        ]]
        let fields: [String: Any] = ["id": "http:fields", "kind": "VStack", "variant": "http-request-fields", "children": [
            ["id": "http:headers", "kind": "TextArea", "label": "请求头 Headers", "value": "{\"Authorization\":\"Bearer …\"}", "action": "headers", "language": "json", "minHeight": 112],
            ["id": "http:body", "kind": "TextArea", "label": "请求体 Body", "value": "{\"message\":\"任务完成\"}", "action": "body", "language": "json", "minHeight": 132],
        ]]
        let request: [String: Any] = ["id": "http", "kind": "VStack", "variant": "http-request-editor", "label": "HTTP 请求 1", "children": [
            ["id": "http:expand", "kind": "Button", "label": "HTTP 请求 1", "text": "POST", "selected": expanded, "action": "expand"],
            ["id": "http:remove", "kind": "IconButton", "label": "删除请求", "icon": "trash", "destructive": true, "action": "remove"],
            address,
        ] + (expanded ? [fields] : [])]
        let task: [String: Any] = ["id": "cron", "kind": "VStack", "variant": "automation-row", "label": "整理工作空间文件并发送完成通知", "icon": "clock", "children": [
            ["id": "cron:schedule", "kind": "Badge", "label": "0 * * * *"],
            ["id": "cron:remaining", "kind": "Badge", "label": "执行次数已耗尽，请编辑后启用", "status": "paused"],
            ["id": "cron:enabled", "kind": "Switch", "label": "编辑任务以增加剩余执行次数", "value": false, "action": "enabled", "disabled": true],
            ["id": "cron:edit", "kind": "IconButton", "label": "编辑任务", "icon": "pencil", "action": "edit"],
            ["id": "cron:view", "kind": "IconButton", "label": "查看执行历史", "icon": "eye", "action": "view"],
        ]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "automation", "revision": 1, "mode": "sheet", "title": "自动化任务",
                                     "appearance": "light", "formFactor": factor, "nodes": [request, task]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
