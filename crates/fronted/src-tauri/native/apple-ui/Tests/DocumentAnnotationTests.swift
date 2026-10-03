import Foundation
import XCTest
@testable import XgentNativeUI

final class DocumentAnnotationTests: XCTestCase {
    func testLengthLimitsMatchJavaScriptUTF16AndPreserveUnicodeScalars() throws {
        let emoji = String(repeating: "😀", count: 6001)
        XCTAssertEqual(XgentDocumentAnnotationDraft.boundedText(emoji), String(repeating: "😀", count: 6000))
        let near = String(repeating: "A", count: 11999)
        XCTAssertEqual(XgentDocumentAnnotationDraft.boundedText(near + "😀"), near)
        XCTAssertEqual(XgentDocumentAnnotationDraft.boundedText(near + "B😀"), near + "B")
        XCTAssertFalse(XgentDocumentAnnotationDraft(text: " \n ", page: 1).canSave)
        XCTAssertFalse(XgentDocumentAnnotationDraft(text: "Note", page: 0).canSave)
        XCTAssertFalse(XgentDocumentAnnotationDraft(text: "Note", page: 2147483648).canSave)
        let draft = XgentDocumentAnnotationDraft(text: "中文 <批注> 😀\n第二行", page: 2)
        let encoded = try XCTUnwrap(draft.encoded)
        XCTAssertEqual(try JSONDecoder().decode(XgentDocumentAnnotationDraft.self, from: Data(encoded.utf8)), draft)
    }

    @MainActor func testSavePayloadUsesCurrentNativeTextAndPageBeforeSharedDocumentUpdate() throws {
        let payload: [String: Any] = ["version": 1, "surface": "annotation", "revision": 1, "mode": "root", "title": "PDF", "nodes": [
            ["id": "workspace-file-annotation-text", "kind": "TextArea", "value": "Old", "action": "text"],
            ["id": "workspace-file-annotation-page", "kind": "NumberInput", "value": 1, "minimum": 1, "maximum": 2147483647, "step": 1, "action": "page"],
            ["id": "workspace-file-save", "kind": "Button", "variant": "workspace-file-save", "action": "save"]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        let model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        model.send(try XCTUnwrap(document.node(id: "workspace-file-annotation-text")), in: document, value: .string("New note 😀"), editing: true)
        model.send(try XCTUnwrap(document.node(id: "workspace-file-annotation-page")), in: document, value: .number(2), editing: true)
        let draft = try XCTUnwrap(XgentDocumentAnnotationDraft.current(in: document, model: model))
        XCTAssertEqual(draft.text, "New note 😀")
        XCTAssertEqual(draft.page, 2)
        let encoded = try XCTUnwrap(draft.encoded)
        model.send(try XCTUnwrap(document.node(id: "workspace-file-save")), in: document, value: .string(encoded))
        let saved = try JSONDecoder().decode(XgentDocumentAnnotationDraft.self, from: Data(try XCTUnwrap(actions.last?.value.text).utf8))
        XCTAssertEqual(saved, draft)
        model.invalidate()
    }
}
