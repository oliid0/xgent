import Foundation
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class WorkspaceEditorBulkTests: XCTestCase {
    @MainActor func testBulkActionsCarryNativeInputAndRetiredConfirmationsCannotAct() throws {
        let document = try fixture(), model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let save = try XCTUnwrap(document.node(id: "workspace-file-save-all"))
        XgentWorkspaceBulkAction.send(save, document: document, model: model)
        XCTAssertTrue(actions.isEmpty, "A clean toolbar action must not request a write")
        model.send(try XCTUnwrap(document.node(id: "workspace-file-editor")), in: document,
                   value: .string("Immediate source 🐦"), editing: true)
        XgentWorkspaceBulkAction.send(save, document: document, model: model)
        let encoded = try XCTUnwrap(actions.last?.value.text)
        let source = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String: String])
        XCTAssertEqual(source, ["kind": "source", "content": "Immediate source 🐦"])
        let oldCancel = try XCTUnwrap(document.node(id: "workspace-editor-bulk-cancel:1"))
        model.update(try fixture(revision: 2, dialogID: 2))
        let count = actions.count
        XgentWorkspaceBulkAction.send(oldCancel, document: document, model: model)
        XCTAssertEqual(actions.count, count)
        let current = try fixture(revision: 2, dialogID: 2)
        XgentWorkspaceBulkAction.send(try XCTUnwrap(current.node(id: "workspace-editor-bulk-cancel:2")), document: current, model: model)
        XCTAssertEqual(actions.last?.value, .null)
        model.invalidate()
    }

    @MainActor func testBulkActionsRemainUsableWhenOnlyBackgroundFilesAreDirty() throws {
        let document = try fixture(editor: false, backgroundDirty: true), model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        XgentWorkspaceBulkAction.send(try XCTUnwrap(document.node(id: "workspace-file-save-all")), document: document, model: model)
        XCTAssertEqual(actions.last?.action, "save-all")
        XCTAssertEqual(actions.last?.value, .null)
        model.invalidate()
    }

    @MainActor func testCloseAllContentFitsNarrowAndWidePresentationsWithLargeFonts() async throws {
        let widths: [CGFloat] = [320, 1040]
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture(files: 24), model = XgentPresentationModel()
                model.update(document)
                let content = XgentWorkspaceCloseAllContent(node: try XCTUnwrap(document.node(id: "workspace-editor-close-all:1")), document: document, model: model)
                    .frame(width: width, height: 640).dynamicTypeSize(size)
                #if os(iOS)
                let host = UIHostingController(rootView: content)
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 640))
                window.rootViewController = host; window.makeKeyAndVisible(); host.view.layoutIfNeeded()
                defer { window.isHidden = true; window.rootViewController = nil; model.invalidate() }
                try await Task.sleep(nanoseconds: 200_000_000)
                let fitted = host.sizeThatFits(in: CGSize(width: width, height: 640))
                #else
                let host = NSHostingView(rootView: content)
                host.frame = CGRect(x: 0, y: 0, width: width, height: 640); host.layoutSubtreeIfNeeded()
                defer { model.invalidate() }
                try await Task.sleep(nanoseconds: 200_000_000)
                let fitted = host.fittingSize
                #endif
                XCTAssertLessThanOrEqual(fitted.width, width + 1)
                XCTAssertLessThanOrEqual(fitted.height, 641, "The file list must scroll inside the presentation")
            }
        }
    }

    private func fixture(revision: Int = 1, dialogID: Int = 1, editor: Bool = true, backgroundDirty: Bool = false, files: Int = 2) throws -> XgentDocument {
        var children: [[String: Any]] = (1...files).map { index in
            ["id": "file:\(index)", "kind": "Text", "variant": "workspace-editor-close-file",
             "label": "Source\(index).swift", "text": "/workspace/a-long-folder-name/Source\(index).swift", "current": 1]
        }
        for (type, label) in [("save", "Save all modified files"), ("discard", "Discard changes"), ("cancel", "Cancel")] {
            children.append(["id": "workspace-editor-bulk-\(type):\(dialogID)", "kind": "Button", "variant": "workspace-editor-bulk-action", "label": label,
                             "action": "\(type):\(dialogID)"])
        }
        var nodes: [[String: Any]] = [
            ["id": "workspace-file-save-all", "kind": "Button", "variant": "workspace-editor-bulk-action", "label": "Save All", "action": "save-all", "current": backgroundDirty ? 1 : 0],
            ["id": "workspace-editor-close-all:\(dialogID)", "kind": "VStack", "variant": "workspace-editor-close-all",
             "label": "Save changes before closing the editor?", "text": "Save modified files or discard changes before closing all tabs.", "children": children]]
        if editor { nodes.append(["id": "workspace-file-editor", "kind": "TextArea", "value": "Original", "action": "edit"]) }
        let payload: [String: Any] = ["version": 1, "surface": "bulk", "revision": revision, "mode": "root", "title": "Editor", "appearance": "system", "nodes": nodes]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
