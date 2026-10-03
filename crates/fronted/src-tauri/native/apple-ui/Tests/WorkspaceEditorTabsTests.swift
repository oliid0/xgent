import Foundation
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class WorkspaceEditorTabsTests: XCTestCase {
    @MainActor func testTabSelectionCarriesImmediateSourceAndRetiredTabActionsCannotSelectAgain() throws {
        let document = try fixture(), model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        model.send(try XCTUnwrap(document.node(id: "workspace-file-editor")), in: document,
                   value: .string("Current native source 😀"), editing: true)
        let select = try XCTUnwrap(document.node(id: "select:2"))
        XgentWorkspaceTabAction.send(select, document: document, model: model)
        let value = try XCTUnwrap(actions.last?.value.text)
        let source = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: String])
        XCTAssertEqual(source, ["kind": "source", "content": "Current native source 😀"])
        let count = actions.count
        model.update(try fixture(revision: 2, count: 1))
        XgentWorkspaceTabAction.send(select, document: document, model: model)
        XCTAssertEqual(actions.count, count)
        model.invalidate()
    }

    @MainActor func testScrollingTabsHugTheirActualHeightAtNarrowWideAndLargeFontSizes() async throws {
        let widths: [CGFloat] = [320, 1040]
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture(count: 12), model = XgentPresentationModel()
                model.update(document)
                var tabHeight: CGFloat = 0
                let tabNode = try XCTUnwrap(document.node(id: "workspace-editor-tabs"))
                let view = VStack(spacing: 0) {
                    XgentWorkspaceEditorTabs(node: tabNode, document: document, model: model)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { tabHeight = $0 }
                    Color.clear.frame(minHeight: 180, maxHeight: .infinity)
                }.frame(width: width, height: 640).dynamicTypeSize(size)
                #if os(iOS)
                let controller = UIHostingController(rootView: view)
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 640))
                window.rootViewController = controller; window.makeKeyAndVisible()
                controller.view.layoutIfNeeded()
                defer { window.isHidden = true; window.rootViewController = nil; model.invalidate() }
                #else
                let host = NSHostingView(rootView: view)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 640), styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                host.layoutSubtreeIfNeeded()
                defer { window.close(); model.invalidate() }
                #endif
                try await Task.sleep(nanoseconds: 300_000_000)
                XCTAssertGreaterThanOrEqual(tabHeight, 44)
                XCTAssertLessThan(tabHeight, size == .large ? 110 : 200,
                                  "Horizontal scrolling must not claim half the editor's vertical space")
            }
        }
    }

    private func fixture(revision: Int = 1, count: Int = 2) throws -> XgentDocument {
        let tabs: [[String: Any]] = (1...count).map { index in
            ["id": "tab:\(index)", "kind": "HStack", "variant": "workspace-editor-tab", "selected": index == 1,
             "label": "Source\(index).swift", "text": "/workspace/Source\(index).swift", "current": index == 1 ? 1 : 0,
             "children": [
                ["id": "select:\(index)", "kind": "Button", "label": "Source\(index).swift", "action": "select:\(index)"],
                ["id": "close:\(index)", "kind": "Button", "label": "Close tab", "action": "close:\(index)"]]]
        }
        let payload: [String: Any] = ["version": 1, "surface": "tabs", "revision": revision, "mode": "root", "title": "Source", "appearance": "system", "nodes": [
            ["id": "workspace-editor-tabs", "kind": "VStack", "variant": "workspace-editor-tabs", "label": "Code editor", "children": tabs],
            ["id": "workspace-file-editor", "kind": "TextArea", "language": "swift", "action": "edit", "value": "Original"]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
