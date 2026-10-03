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
                let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view).flattenToElements()
                for id in ["question:option", "question:other", "question:tabs:0", "question:submit"] {
                    let element = try XCTUnwrap(elements.first { $0.identifier == id && $0.traits.contains(.button) })
                    let rect = element.shape.bezierPath.bounds
                    XCTAssertGreaterThanOrEqual(rect.height, 43.5)
                    XCTAssertGreaterThanOrEqual(rect.minX, -1)
                    XCTAssertLessThanOrEqual(rect.maxX, width + 1)
                }
                let selected = try XCTUnwrap(elements.first { $0.identifier == "question:other" })
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
                let button = try XCTUnwrap(accessibility(host).first { $0.accessibilityIdentifier() == "question:option" })
                XCTAssertTrue(button.accessibilityPerformPress())
                try await Task.sleep(nanoseconds: 30_000_000)
                XCTAssertEqual(actions.last?.action, "option")
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
    #endif

    private func fixture() throws -> XgentDocument {
        let card: [String: Any] = ["id": "question", "kind": "VStack", "variant": "question-card", "children": [
            ["id": "question:tabs", "kind": "SegmentedControl", "label": "问题", "value": "0", "action": "tabs", "options": [
                ["value": "0", "label": "演示文稿风格"], ["value": "1", "label": "文档输出格式"],
            ]],
            ["id": "question:prompt", "kind": "Text", "text": "选择演示文稿的风格，也可以输入自己的要求。"],
            ["id": "question:option", "kind": "Button", "variant": "question-option", "label": "简洁的商务风格", "text": "使用清晰的层级和少量强调颜色，便于展示表格及任务结果。", "action": "option", "selected": false, "children": [
                ["id": "question:recommended", "kind": "Badge", "label": "推荐"],
            ]],
            ["id": "question:other", "kind": "Button", "variant": "question-option", "label": "其他", "selected": true, "action": "other"],
            ["id": "question:custom", "kind": "TextInput", "label": "其他", "text": "输入你的要求", "value": "使用蓝色主题", "action": "custom"],
            ["id": "question:footer", "kind": "VStack", "variant": "question-footer", "children": [
                ["id": "question:status", "kind": "Text", "text": "2/2 · 2:49", "secondary": true],
                ["id": "question:submit", "kind": "Button", "label": "提交回答", "action": "submit", "prominent": true],
            ]],
        ]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "chat", "revision": 1, "mode": "root", "title": "对话", "formFactor": factor, "nodes": [card]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
