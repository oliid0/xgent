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

final class WorkspaceImageRenderingTests: XCTestCase {
    @MainActor func testImageActionsFitNarrowScreensAndAccessibilityText() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 430]
        #else
        let widths: [CGFloat] = [360, 1040]
        #endif
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture(), model = XgentPresentationModel()
                model.update(document)
                let content = XgentWorkspaceImagePreview(node: try XCTUnwrap(document.node(id: "workspace-file-media")), document: document, model: model)
                    .frame(width: width, height: 640).dynamicTypeSize(size)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                #if os(iOS)
                let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 640))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded(); try await Task.sleep(nanoseconds: 150_000_000)
                let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view).flattenToElements()
                for suffix in ["previous", "next", "rotation", "save", "zoom-out", "zoom-in", "fit"] {
                    let element = try XCTUnwrap(elements.first { $0.identifier == "workspace-file-image-\(suffix)" }, suffix)
                    XCTAssertGreaterThanOrEqual(element.shape.bezierPath.bounds.minX, -1, suffix)
                    XCTAssertLessThanOrEqual(element.shape.bezierPath.bounds.maxX, width + 1, suffix)
                }
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 640))
                let image = await withCheckedContinuation { continuation in strategy.snapshot(host.view).run { continuation.resume(returning: $0) } }
                #else
                let host = NSHostingView(rootView: content); host.frame = CGRect(x: 0, y: 0, width: width, height: 640)
                host.layoutSubtreeIfNeeded(); XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 640))
                let image = await withCheckedContinuation { continuation in strategy.snapshot(host).run { continuation.resume(returning: $0) } }
                #endif
                let attachment = XCTAttachment(image: image); attachment.name = "workspace-image-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways; add(attachment); model.invalidate()
            }
        }
    }

    private func fixture() throws -> XgentDocument {
        func button(_ suffix: String, _ label: String, _ icon: String) -> [String: Any] {
            ["id": "workspace-file-image-\(suffix)", "kind": "Button", "label": label, "icon": icon, "action": suffix]
        }
        let media: [String: Any] = ["id": "workspace-file-media", "kind": "MediaPreview", "variant": "workspace-image-preview", "language": "image/png",
            "value": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fKAAAAAASUVORK5CYII=", "current": 0,
            "label": "复杂任务生成的结果图片.png", "text": "第 1 张，共 12 张", "children": [
                button("previous", "上一张", "chevron.left"), button("next", "下一张", "chevron.right"),
                button("zoom-out", "缩小", "minus"), button("zoom-in", "放大", "plus"), button("fit", "适合窗口", "arrow.up.left.and.arrow.down.right"),
                ["id": "workspace-file-image-rotation", "kind": "NumberInput", "variant": "workspace-image-rotation", "label": "旋转图片", "value": 90, "action": "rotate", "minimum": 0, "maximum": 270, "step": 90],
                button("save", "保存", "square.and.arrow.down")]]
        let payload: [String: Any] = ["version": 1, "surface": "image", "revision": 1, "mode": "root", "title": "Image", "nodes": [media]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload)); try document.validate()
        return document
    }
}
