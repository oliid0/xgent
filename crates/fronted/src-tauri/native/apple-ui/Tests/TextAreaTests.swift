#if os(iOS)
import Foundation
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class TextAreaTests: XCTestCase {
    @MainActor func testMultilineFormFieldHeightTypingAndRetiredEdits() async throws {
        let payload: [String: Any] = ["version": 1, "surface": "soul-body", "revision": 1,
            "mode": "root", "title": "Soul", "appearance": "light", "formFactor": "mobile", "nodes": [
                ["id": "body", "kind": "TextArea", "label": "Personality", "value": "Initial text",
                 "minHeight": 240, "action": "edit-body"]
            ]]
        let document = try JSONDecoder().decode(XgentDocument.self,
            from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        model.update(document)
        let node = try XCTUnwrap(document.nodes.first)
        let host = UIHostingController(rootView: ScrollView {
            XgentTextArea(node: node, document: document, model: model).padding(16)
        })
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 640))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; model.invalidate() }
        try await Task.sleep(nanoseconds: 200_000_000)
        host.view.layoutIfNeeded()
        let editor = try XCTUnwrap(textView(in: host.view))
        XCTAssertGreaterThanOrEqual(editor.bounds.height, 239)
        XCTAssertLessThanOrEqual(editor.bounds.height, 300, "A form editor must leave room for the other settings")
        XCTAssertTrue(editor.becomeFirstResponder())
        editor.selectedRange = NSRange(location: editor.text.utf16.count, length: 0)
        editor.insertText("\n末尾🙂")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(actions.last?.action, "edit-body")
        XCTAssertEqual(actions.last?.value, .string("Initial text\n末尾🙂"))
        model.invalidate()
        let count = actions.count
        editor.insertText("late edit")
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(actions.count, count)
    }

    @MainActor private func textView(in view: UIView) -> UITextView? {
        if let input = view as? UITextView { return input }
        for child in view.subviews { if let input = textView(in: child) { return input } }
        return nil
    }
}
#endif
