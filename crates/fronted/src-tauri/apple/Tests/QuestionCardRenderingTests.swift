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

final class QuestionCardRenderingTests: XCTestCase {
    @MainActor func testNativeQuestionControlsFitNarrowAndLargeTextWithRealButtons() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 430, 768]
        #else
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        let widths: [CGFloat] = [480, 1040]
        #endif
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel()
                model.update(document)
                var actions: [XgentAction] = []
                model.actionSink = { action in
                    actions.append(action)
                    model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
                }
                let content = ScrollView {
                    XgentQuestionCard(node: document.nodes[0], document: document, model: model).padding(16)
                }.frame(width: width, height: 1000).dynamicTypeSize(size)
                    .environment(\.accessibilityEnabled, true)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                #if os(iOS)
                let host = UIHostingController(rootView: content)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 1000))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 150_000_000)
                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                try attachNativeAccessibilityEvidence(hierarchy, name: "question-accessibility-\(Int(width))-\(size)")
                let elements = hierarchy.flattenToElements()
                for id in ["question:option", "question:previous", "question:next", "question:close", "question:skip", "question:submit"] {
                    let element = try XCTUnwrap(elements.first { $0.identifier == id && $0.traits.contains(.button) })
                    let rect = element.shape.bezierPath.bounds
                    XCTAssertGreaterThanOrEqual(rect.height, 43.5)
                    XCTAssertGreaterThanOrEqual(rect.minX, -1)
                    XCTAssertLessThanOrEqual(rect.maxX, width + 1)
                }
                let selected = try XCTUnwrap(elements.first { $0.identifier == "question:option" })
                XCTAssertTrue(selected.traits.contains(.selected))
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 1000))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                #else
                let host = NSHostingView(rootView: content)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 1000),
                    styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host
                window.makeKeyAndOrderFront(nil)
                defer { window.close() }
                host.layoutSubtreeIfNeeded()
                try await Task.sleep(nanoseconds: 150_000_000)
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let elements = accessibility(host)
                try attachNativeAccessibilityEvidence(elements.map { ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityLabel() ?? ""] },
                    name: "question-accessibility-\(Int(width))-\(size)")
                let button = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "question:option" })
                XCTAssertTrue(button.accessibilityPerformPress())
                try await Task.sleep(nanoseconds: 30_000_000)
                XCTAssertEqual(actions.last?.action, "option")
                for id in ["previous", "next", "close", "skip", "submit"] {
                    let control = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "question:\(id)" })
                    XCTAssertTrue(control.accessibilityPerformPress())
                    try await Task.sleep(nanoseconds: 30_000_000)
                    XCTAssertEqual(actions.last?.action, id)
                }
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 1000))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                #endif
                let attachment = XCTAttachment(image: image)
                attachment.name = "question-card-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
                model.invalidate()
            }
        }
    }

    #if os(macOS)
    @MainActor private func accessibility(_ root: Any) -> [NativeMacAccessibilityElement] {
        nativeMacAccessibilityTree(root)
    }
    #endif

    private func fixture() throws -> XgentDocument {
        let card: [String: Any] = ["id": "question", "kind": "VStack", "variant": "question-card", "children": [
            ["id": "question:header", "kind": "HStack", "variant": "question-header", "children": [
                ["id": "question:prompt", "kind": "Text", "text": "选择演示文稿的风格，也可以输入自己的要求。"],
                ["id": "question:navigation", "kind": "HStack", "children": [
                    ["id": "question:previous", "kind": "Button", "label": "上一个问题", "icon": "chevron.left", "action": "previous"],
                    ["id": "question:counter", "kind": "Text", "text": "2/3"],
                    ["id": "question:next", "kind": "Button", "label": "下一个问题", "icon": "chevron.right", "action": "next"],
                    ["id": "question:close", "kind": "Button", "label": "关闭提问", "icon": "xmark", "action": "close"],
                ]],
            ]],
            ["id": "question:option", "kind": "Button", "variant": "question-option", "label": "简洁的商务风格", "text": "使用清晰的层级和少量强调颜色，便于展示表格及任务结果。", "action": "option", "selected": true, "children": [
                ["id": "question:recommended", "kind": "Badge", "label": "推荐"],
            ]],
            ["id": "question:custom", "kind": "TextInput", "label": "其他", "text": "输入你的要求", "value": "", "action": "custom", "variant": "compact", "size": "medium"],
            ["id": "question:footer", "kind": "VStack", "variant": "question-footer", "children": [
                ["id": "question:status", "kind": "Text", "text": "2/2 · 2:49", "secondary": true],
                ["id": "question:skip", "kind": "Button", "label": "跳过", "action": "skip", "variant": "ghost", "size": "small"],
                ["id": "question:submit", "kind": "Button", "label": "提交回答", "action": "submit", "prominent": true],
            ]],
        ]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "chat", "revision": 1, "mode": "root", "title": "对话", "appearance": "light", "formFactor": factor, "nodes": [card]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
