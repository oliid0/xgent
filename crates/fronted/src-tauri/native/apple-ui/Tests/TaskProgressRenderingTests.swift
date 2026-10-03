import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class TaskProgressRenderingTests: XCTestCase {
    @MainActor func testTaskChipAndScrollablePopoverRetainLongTitlesAndDescriptions() async throws {
        for size in [DynamicTypeSize.large, .accessibility3] {
            let document = try fixture()
            let node = document.nodes[0]
            let model = XgentPresentationModel()
            model.update(document)
            let content = VStack(alignment: .leading, spacing: 20) {
                XgentTaskProgressChip(node: node, document: document, model: model)
                Divider()
                XgentTaskProgressPopover(node: node, document: document, model: model)
            }.padding(16).frame(width: 320, height: 700, alignment: .topLeading)
                .dynamicTypeSize(size)
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .dark))
            #if os(iOS)
            let host = UIHostingController(rootView: content)
            host.safeAreaRegions = []
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 700))
            window.rootViewController = host
            window.makeKeyAndVisible()
            defer { window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 100_000_000)
            let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: 320, height: 700))
            let image = await withCheckedContinuation { continuation in
                strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
            }
            #else
            let host = NSHostingView(rootView: content)
            host.frame = CGRect(x: 0, y: 0, width: 320, height: 700)
            host.layoutSubtreeIfNeeded()
            XCTAssertLessThanOrEqual(host.fittingSize.width, 321)
            let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: 320, height: 700))
            let image = await withCheckedContinuation { continuation in
                strategy.snapshot(host).run { continuation.resume(returning: $0) }
            }
            #endif
            let attachment = XCTAttachment(image: image)
            attachment.name = "task-progress-\(size)"
            attachment.lifetime = .keepAlways
            add(attachment)
            model.invalidate()
        }
    }

    private func fixture() throws -> XgentDocument {
        let steps: [[String: Any]] = [
            ["id": "task:search", "kind": "TaskStep", "label": "搜索并整理资料", "status": "completed", "accessibilityValue": "已完成"],
            ["id": "task:document", "kind": "TaskStep", "label": "制作 Word 文档、Excel 表格和单文件 HTML", "text": "保留来源链接和生成结果，并检查表格中的计算。", "status": "running", "accessibilityValue": "正在工作"],
            ["id": "task:slides", "kind": "TaskStep", "label": "转换成 PPTX 并制作动画", "status": "pending", "accessibilityValue": "待办事项"],
        ]
        let node: [String: Any] = ["id": "task-progress:run", "kind": "TaskProgress", "label": "制作 Word 文档、Excel 表格和单文件 HTML", "text": "1/3", "accessibilityLabel": "待办事项", "current": 1, "total": 3, "status": "running", "children": steps]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "chat", "revision": 1, "mode": "root", "title": "对话", "formFactor": factor, "nodes": [node]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
