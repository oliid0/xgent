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

final class WorkspaceSpreadsheetRenderingTests: XCTestCase {
    @MainActor func testSpreadsheetAndFileActionsFitNarrowScreensAndLargeText() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 430]
        #else
        let widths: [CGFloat] = [360, 1040]
        #endif
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
                let model = XgentPresentationModel()
                model.update(document)
                let content = VStack {
                    #if os(iOS)
                    XgentIOSNodes(nodes: document.nodes, document: document, model: model)
                    #else
                    ForEach(document.nodes) { XgentNodeView(node: $0, document: document, model: model) }
                    #endif
                }.frame(width: width, height: 780).dynamicTypeSize(size)
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
                for id in ["workspace-file-save", "workspace-file-reload", "workspace-file-close"] {
                    let element = try XCTUnwrap(elements.first { $0.identifier == id }, id)
                    XCTAssertGreaterThanOrEqual(element.shape.bezierPath.bounds.minX, -1, id)
                    XCTAssertLessThanOrEqual(element.shape.bezierPath.bounds.maxX, width + 1, id)
                }
                XCTAssertTrue(elements.contains { $0.identifier == "spreadsheet-cell:Report:0:0" })
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
                attachment.name = "spreadsheet-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
                model.invalidate()
            }
        }
    }

    private func fixture() throws -> XgentDocument {
        let rows: [[String: Any]] = (0..<20).map { row in
            ["rowIndex": row, "cells": (0..<8).map { column in ["columnIndex": column, "value": "业务数据 \(row):\(column)"] }]
        }
        let table: [String: Any] = ["sheet": "Report", "editable": true, "rows": rows]
        let value = String(data: try JSONSerialization.data(withJSONObject: table), encoding: .utf8)!
        func button(_ id: String, _ label: String, _ icon: String) -> [String: Any] {
            ["id": id, "kind": "Button", "label": label, "icon": icon, "action": id]
        }
        let layout: [String: Any] = ["id": "workspace-file-layout", "kind": "VStack", "variant": "workspace-file-layout", "fill": true, "children": [
            ["id": "workspace-file-toolbar", "kind": "TerminalToolbar", "variant": "workspace-file-toolbar", "padding": 10, "children": [
                ["id": "workspace-file-title", "kind": "Heading", "text": "项目季度业务统计与复杂任务结果.xlsx"],
                button("workspace-file-save", "保存", "square.and.arrow.down"),
                button("workspace-file-reload", "重新加载", "arrow.clockwise"),
                button("workspace-file-close", "关闭", "xmark")]],
            ["id": "workspace-file-sheets", "kind": "Selector", "variant": "workspace-file-sheets", "value": "Report", "action": "sheet", "options": [
                ["value": "Report", "label": "Report"], ["value": "Second", "label": "第二工作表"]]],
            ["id": "workspace-file-spreadsheet", "kind": "SpreadsheetGrid", "value": value, "action": "edit", "fill": true],
            ["id": "workspace-file-metadata", "kind": "HStack", "variant": "workspace-file-metadata", "padding": 10, "children": [
                ["id": "workspace-file-size", "kind": "Badge", "label": "12,345,678 B"],
                ["id": "workspace-file-lines", "kind": "Badge", "label": "25,000 行"]]]]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "sheet", "revision": 1, "mode": "root", "title": "Sheet", "formFactor": factor, "nodes": [layout]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
