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

final class BrowserControlsRenderingTests: XCTestCase {
    @MainActor func testBrowserChromeKeepsAddressAndActionsInsideNarrowAndLargeTextLayouts() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 430]
        #else
        let widths: [CGFloat] = [360, 920]
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
                for id in ["browser-address:one", "browser-go:one", "browser-back", "browser-forward", "browser-close-tab"] {
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
                attachment.name = "browser-chrome-\(Int(width))-\(textSize)"
                attachment.lifetime = .keepAlways
                add(attachment)
                model.invalidate()
            }
        }
    }

    @MainActor func testAddressDraftSurvivesUnrelatedDocumentUpdatesAndDoesNotLeakToAnotherTab() throws {
        let model = XgentPresentationModel()
        let document = try fixture()
        model.update(document)
        let input = try XCTUnwrap(document.node(id: "browser-address:one"))
        let submit = try XCTUnwrap(document.node(id: "browser-go:one"))
        var dispatched: [XgentAction] = []
        model.actionSink = { dispatched.append($0) }
        model.send(input, in: document, value: .string("latest.test"), editing: true)
        XCTAssertEqual(model.value(input, in: document).text, "latest.test")
        let refreshed = try fixture(revision: 2)
        model.update(refreshed)
        XCTAssertEqual(model.value(input, in: refreshed).text, "latest.test")
        model.send(submit, in: document, value: model.value(input, in: document))
        XCTAssertEqual(dispatched.last?.value.text, "latest.test")
        let another = try fixture(session: "two", revision: 3)
        model.update(another)
        let otherInput = try XCTUnwrap(another.node(id: "browser-address:two"))
        XCTAssertEqual(model.value(otherInput, in: another).text, "https://example.test")
        model.invalidate()
    }

    private func fixture(session: String = "one", revision: Int = 1) throws -> XgentDocument {
        func icon(_ id: String, _ label: String, _ image: String) -> [String: Any] {
            ["id": id, "kind": "IconButton", "label": label, "icon": image, "action": id, "variant": "ghost"]
        }
        let entry: [String: Any] = ["id": "browser-address-entry", "kind": "VStack", "variant": "browser-address-entry", "fill": true, "children": [
            ["id": "browser-address:\(session)", "kind": "TextInput", "label": "输入网址", "value": "https://example.test", "action": "address"],
            icon("browser-go:\(session)", "打开网址", "arrow.right")]]
        let tabs: [String: Any] = ["id": "browser-tabs", "kind": "VStack", "variant": "browser-tabs", "children": [
            icon("browser-new", "新标签页", "plus"),
            ["id": "browser-tab-items", "kind": "VStack", "variant": "browser-tab-items", "children": [
                ["id": "browser-tab:\(session)", "kind": "Button", "label": "资料检索与文稿制作工作台", "text": "https://example.test", "selected": true, "action": "select"],
                ["id": "browser-tab:other", "kind": "Button", "label": "另一个标签", "status": "running", "action": "other"]]],
            icon("browser-close-tab", "关闭标签", "xmark")]]
        let navigation: [String: Any] = ["id": "browser-navigation", "kind": "VStack", "variant": "browser-navigation", "children": [
            icon("browser-back", "后退", "chevron.left"), icon("browser-forward", "前进", "chevron.right"), entry,
            icon("browser-reload", "刷新", "arrow.clockwise")]]
        let layout: [String: Any] = ["id": "browser-layout", "kind": "BrowserLayout", "fill": true, "children": [tabs, navigation,
            ["id": "browser-error", "kind": "VStack", "variant": "browser-error", "children": [
                ["id": "error", "kind": "Banner", "status": "error", "label": "网页暂时无法打开，请检查网络后重试；标签和网址仍然保留。"],
                icon("dismiss-error", "关闭提示", "xmark")]],
            ["id": "browser-empty", "kind": "VStack", "variant": "browser-empty", "fill": true, "children": [
                ["id": "empty", "kind": "EmptyState", "label": "开始浏览", "text": "输入网址或打开新的标签页。", "icon": "globe"]]]]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "browser", "revision": revision, "mode": "root", "title": "Browser", "formFactor": factor, "nodes": [layout]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
