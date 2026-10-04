#if os(iOS)
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class TextInputCommitRenderingTests: XCTestCase {
    @MainActor func testActualSecureTextFieldCommitsOnceOnBlurAndReturnWithItsFinalValue() async throws {
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "proxy", "revision": 1, "mode": "root", "title": "Proxy", "appearance": "light",
            "nodes": [["id": "password", "kind": "TextInput", "label": "Proxy password", "value": "", "secure": true,
                       "action": "edit", "commitAction": "commit"]]]))
        try document.validate()
        let node = try XCTUnwrap(document.nodes.first), model = XgentPresentationModel()
        model.update(document)
        var events: [XgentAction] = []
        model.actionSink = { events.append($0) }
        let controller = UIHostingController(rootView: XgentTextInput(node: node, document: document, model: model).padding(16))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 720))
        window.rootViewController = controller; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; model.invalidate() }
        controller.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(150))
        let field = try XCTUnwrap(findField(controller.view))
        XCTAssertTrue(field.isSecureTextEntry)
        XCTAssertTrue(field.becomeFirstResponder())
        field.text = "first secret"
        field.sendActions(for: .editingChanged)
        field.resignFirstResponder()
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(events.filter { $0.action == "commit" }.map(\.value), [.string("first secret")])
        XCTAssertTrue(field.becomeFirstResponder())
        field.text = "last secret"
        field.sendActions(for: .editingChanged)
        XCTAssertTrue(field.delegate?.textFieldShouldReturn?(field) ?? false)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(events.filter { $0.action == "commit" }.map(\.value), [.string("first secret"), .string("last secret")])
    }

    @MainActor private func findField(_ view: UIView) -> UITextField? {
        if let field = view as? UITextField, field.accessibilityIdentifier == "password" { return field }
        for child in view.subviews { if let field = findField(child) { return field } }
        return nil
    }
}
#endif
