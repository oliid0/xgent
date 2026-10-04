#if os(iOS)
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class ComposerInputSelectionTests: XCTestCase {
    @MainActor func testNativeTypingReportsTheCaretAndAnInsertedMentionRestoresItsRequestedPosition() async throws {
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        model.update(try document(revision: 1, text: "Read  suffix", focus: 0, caret: 5))
        let host = UIHostingController(rootView: XgentRootLayout(model: model))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 720))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        host.view.layoutIfNeeded()
        try await Task.sleep(nanoseconds: 200_000_000)
        let input = try XCTUnwrap(textView(in: host.view))
        XCTAssertTrue(input.becomeFirstResponder())
        input.selectedRange = NSRange(location: 5, length: 0)
        input.insertText("@"); try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(input.text, "Read @ suffix")
        let selection = try XCTUnwrap(actions.last { $0.action == "selection" })
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(selection.value.text.utf8)) as? [String: Any])
        XCTAssertEqual(payload["text"] as? String, input.text)
        XCTAssertEqual(payload["location"] as? Int, 6)
        for action in actions {
            model.complete(.init(surface: "composer", requestId: action.requestId, ok: true, error: nil, acceptedValue: action.value))
        }
        model.update(try document(revision: 2, text: "Read @ suffix", focus: 0, caret: 6))
        try await Task.sleep(nanoseconds: 50_000_000)
        model.update(try document(revision: 3, text: "Read [doc](doc.md)  suffix", focus: 1, caret: 19))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(textView(in: host.view) === input)
        XCTAssertEqual(input.selectedRange.location, 19)
    }

    private func document(revision: Int, text: String, focus: Int, caret: Int) throws -> XgentDocument {
        let request = String(data: try JSONSerialization.data(withJSONObject: ["request": focus, "location": caret, "length": 0]), encoding: .utf8)!
        let result = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "composer", "revision": revision, "mode": "root", "title": "Chat", "appearance": "light", "formFactor": "mobile",
            "nodes": [["id": "composer", "kind": "Composer", "children": [["id": "draft", "kind": "ComposerInput", "label": "Message", "value": text,
                "action": "draft", "selectionAction": "selection", "text": request, "focusRequest": focus]]]],
        ]))
        try result.validate(); return result
    }

    @MainActor private func textView(in view: UIView) -> UITextView? {
        if let input = view as? UITextView { return input }
        return view.subviews.lazy.compactMap { self.textView(in: $0) }.first
    }
}
#endif
