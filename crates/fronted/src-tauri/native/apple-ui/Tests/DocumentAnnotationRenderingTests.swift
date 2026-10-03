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

final class DocumentAnnotationRenderingTests: XCTestCase {
    @MainActor func testAnnotationControlsStayUsableInNarrowAndLargeTextLayouts() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 430]
        #else
        let widths: [CGFloat] = [360, 1040]
        #endif
        for width in widths {
            for textSize in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel()
                model.update(document)
                let content = VStack {
                    #if os(iOS)
                    XgentIOSNodes(nodes: document.nodes, document: document, model: model)
                    #else
                    ForEach(document.nodes) { XgentNodeView(node: $0, document: document, model: model) }
                    #endif
                }.frame(width: width, height: 780).dynamicTypeSize(textSize)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                #if os(iOS)
                let host = UIHostingController(rootView: content)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 780))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 150_000_000)
                let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view).flattenToElements()
                for id in ["workspace-file-save", "workspace-file-annotation-page", "workspace-file-annotation-text"] {
                    let element = try XCTUnwrap(elements.first { $0.identifier == id }, id)
                    XCTAssertGreaterThanOrEqual(element.shape.bezierPath.bounds.minX, -1, id)
                    XCTAssertLessThanOrEqual(element.shape.bezierPath.bounds.maxX, width + 1, id)
                }
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 780))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                #else
                let host = NSHostingView(rootView: content)
                host.frame = CGRect(x: 0, y: 0, width: width, height: 780)
                host.layoutSubtreeIfNeeded()
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 780))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                #endif
                let attachment = XCTAttachment(image: image)
                attachment.name = "annotations-\(Int(width))-\(textSize)"
                attachment.lifetime = .keepAlways
                add(attachment)
                model.invalidate()
            }
        }
    }

    private func fixture() throws -> XgentDocument {
        let layout: [String: Any] = ["id": "workspace-file-layout", "kind": "VStack", "variant": "workspace-file-layout", "fill": true, "children": [
            ["id": "workspace-file-toolbar", "kind": "TerminalToolbar", "variant": "workspace-file-toolbar", "padding": 10, "children": [
                ["id": "workspace-file-title", "kind": "Heading", "text": "复杂任务生成的文稿与演示文档.pdf"],
                ["id": "workspace-file-save", "kind": "Button", "variant": "workspace-file-save", "label": "保存批注", "icon": "square.and.arrow.down", "action": "save"]]],
            ["id": "workspace-file-annotations", "kind": "VStack", "variant": "workspace-file-annotations", "fill": true, "padding": 12, "children": [
                ["id": "workspace-file-annotation-help", "kind": "Text", "text": "将批注保存到 PDF 的指定页面。", "secondary": true],
                ["id": "workspace-file-annotation-page", "kind": "NumberInput", "variant": "document-annotation-page", "label": "页码 / 幻灯片", "value": 2, "minimum": 1, "maximum": 2147483647, "step": 1, "action": "page"],
                ["id": "workspace-file-annotation-text", "kind": "TextArea", "variant": "document-annotation", "label": "批注", "value": "当前中文备注 😀\n第二行说明，保存后可在原文档中查看。", "fill": true, "action": "text"]]]]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "annotation", "revision": 1, "mode": "root", "title": "Annotations", "formFactor": factor, "nodes": [layout]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
