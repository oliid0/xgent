import XCTest
#if os(iOS)
import SwiftUI
import UIKit
#endif
@testable import XgentNativeUI

final class ColorInputTests: XCTestCase {
    func testHexDraftsOnlyCommitCompleteSRGBColors() {
        XCTAssertEqual(XgentHexColor.normalized("#ABC123"), "#abc123")
        for value in ["", "#", "#fff", "#12345g", "#12345678", "red", "#123456\n", " #123456"] {
            XCTAssertNil(XgentHexColor.normalized(value))
        }
    }

    func testColorPickerRoundsAndBoundsExtendedComponentsWithoutInvalidHEX() {
        XCTAssertEqual(XgentHexColor.value(red: 1, green: 0.5, blue: 0), "#ff8000")
        XCTAssertEqual(XgentHexColor.value(red: -0.2, green: 1.2, blue: 0), "#00ff00")
        XCTAssertNil(XgentHexColor.value(red: .nan, green: 0, blue: 0))
    }

    #if os(iOS)
    @MainActor func testActualHEXFieldKeepsPartialDraftsLocalAndPublishesValidEdits() async throws {
        let payload: [String: Any] = ["version": 1, "surface": "color-input", "revision": 1,
            "mode": "root", "title": "Appearance", "appearance": "light", "nodes": [
                ["id": "accent", "kind": "ColorInput", "label": "Accent color", "value": "#123456", "action": "accent"]
            ]]
        let document = try JSONDecoder().decode(XgentDocument.self,
            from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        model.update(document)
        let node = try XCTUnwrap(document.nodes.first)
        let host = UIHostingController(rootView: XgentColorInput(node: node, document: document, model: model)
            .environment(\.xgentSettingsRow, true).padding(16))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 640))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; model.invalidate() }
        try await Task.sleep(nanoseconds: 100_000_000)
        let field = try XCTUnwrap(textField(in: host.view))
        field.becomeFirstResponder()
        field.text = "#12"
        field.sendActions(for: .editingChanged)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(actions.isEmpty)
        XCTAssertEqual(model.value(node, in: document), .string("#123456"))
        field.text = "#ABCDEF"
        field.sendActions(for: .editingChanged)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(actions.last?.action, "accent")
        XCTAssertEqual(actions.last?.value, .string("#abcdef"))
        model.invalidate()
        let count = actions.count
        field.text = "#ffffff"
        field.sendActions(for: .editingChanged)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(actions.count, count)
    }

    @MainActor private func textField(in view: UIView) -> UITextField? {
        if let field = view as? UITextField { return field }
        for child in view.subviews { if let field = textField(in: child) { return field } }
        return nil
    }
    #endif
}
