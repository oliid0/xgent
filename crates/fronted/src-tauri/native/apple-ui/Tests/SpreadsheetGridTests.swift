import Foundation
import XCTest
@testable import XgentNativeUI

final class SpreadsheetGridTests: XCTestCase {
    func testCellLengthUsesExcelUTF16BoundsWithoutSplittingEmoji() {
        let prefix = String(repeating: "a", count: 32766)
        XCTAssertEqual(XgentSpreadsheetCellText.bounded(prefix + "😀"), prefix)
        XCTAssertEqual(XgentSpreadsheetCellText.bounded(prefix + "b😀"), prefix + "b")
        XCTAssertNil(XgentSpreadsheetData.Edit(sheet: "Report", row: 0, column: 0, value: prefix + "😀").encoded)
    }
    func testCoordinatesAndHeadersMatchExcel() throws {
        XCTAssertEqual(XgentSpreadsheetData.columnName(0), "A")
        XCTAssertEqual(XgentSpreadsheetData.columnName(25), "Z")
        XCTAssertEqual(XgentSpreadsheetData.columnName(26), "AA")
        XCTAssertEqual(XgentSpreadsheetData.columnName(79), "CB")
        XCTAssertEqual(XgentSpreadsheetData.columnName(-1), "")
        let text = try XCTUnwrap(XgentSpreadsheetData.Edit(sheet: "业务数据", row: 249, column: 79, value: "空格 \"与\" 换行\n").encoded)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        XCTAssertEqual(json["sheet"] as? String, "业务数据")
        XCTAssertEqual(json["row"] as? Int, 249)
        XCTAssertEqual(json["column"] as? Int, 79)
        XCTAssertEqual(json["value"] as? String, "空格 \"与\" 换行\n")
    }

    func testGridRejectsInvalidAndDuplicateCoordinatesBeforeRendering() {
        XCTAssertNotNil(XgentSpreadsheetData.decode(#"{"sheet":"Report","editable":true,"rows":[{"rowIndex":0,"cells":[{"columnIndex":0,"value":"First"}]}]}"#))
        for rows in [
            #"[{"rowIndex":-1,"cells":[]}]"#,
            #"[{"rowIndex":0,"cells":[{"columnIndex":-1,"value":"X"}]}]"#,
            #"[{"rowIndex":0,"cells":[]},{"rowIndex":0,"cells":[]}]"#,
            #"[{"rowIndex":0,"cells":[{"columnIndex":80,"value":"X"}]}]"#
        ] {
            XCTAssertNil(XgentSpreadsheetData.decode("{\"sheet\":\"Report\",\"editable\":true,\"rows\":\(rows)}"))
        }
        XCTAssertNil(XgentSpreadsheetData.decode("invalid"))
    }

    @MainActor func testRapidCellEditsAreContinuousAndRetiredActionsCannotWrite() throws {
        let payload: [String: Any] = ["version": 1, "surface": "sheet", "revision": 1, "mode": "root", "title": "Sheet", "nodes": [
            ["id": "grid", "kind": "SpreadsheetGrid", "value": "{\"sheet\":\"Report\",\"editable\":true,\"rows\":[]}", "action": "edit"]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        let model = XgentPresentationModel()
        model.update(document)
        let node = try XCTUnwrap(document.node(id: "grid"))
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        for value in ["A", "AB", "ABC"] {
            let edit = try XCTUnwrap(XgentSpreadsheetData.Edit(sheet: "Report", row: 0, column: 0, value: value).encoded)
            model.send(node, in: document, value: .string(edit), continuous: true)
        }
        XCTAssertEqual(actions.count, 3)
        XCTAssertFalse(model.isBusy(node, in: document))
        XCTAssertEqual(model.value(node, in: document).text, node.value?.text)
        model.invalidate()
        model.send(node, in: document, value: .string("retired"), continuous: true)
        XCTAssertEqual(actions.count, 3)
    }
}
