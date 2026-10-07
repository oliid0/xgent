#if os(iOS)
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MemoryFormEditingTests: XCTestCase {
    @MainActor func testPlainMemoryFieldScalesAndSendsFinalUnicodeText() async throws {
        let body: [String: Any] = ["id": "memory-body", "kind": "TextArea", "label": "Memory body",
            "value": "Remember", "action": "body"]
        let group: [String: Any] = ["id": "memory-create-form", "kind": "SettingsGroup", "label": "New memory",
            "children": [body, ["id": "save", "kind": "Button", "label": "Save memory", "action": "save"]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "memory", "revision": 1, "mode": "sheet", "title": "Memory",
            "appearance": "light", "formFactor": "mobile", "nodes": [group],
        ]))
        try document.validate()
        var standardSize: CGFloat = 0
        for size in [DynamicTypeSize.large, .accessibility3] {
            let model = XgentPresentationModel()
            model.update(document)
            defer { model.invalidate() }
            var actions: [XgentAction] = []
            model.actionSink = { actions.append($0) }
            let view = XgentIOSSettingsForm(nodes: document.nodes, document: document, model: model)
                .dynamicTypeSize(size)
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
            let host = UIHostingController(rootView: view)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 720))
            window.rootViewController = host
            window.makeKeyAndVisible()
            defer { window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 200_000_000)
            let input = try XCTUnwrap(textView(in: host.view))
            let font = try XCTUnwrap(input.font)
            XCTAssertFalse(font.fontDescriptor.symbolicTraits.contains(.traitMonoSpace),
                "A memory form uses prose typography without a code gutter")
            if size == .large { standardSize = font.pointSize }
            else { XCTAssertGreaterThan(font.pointSize, standardSize * 1.5) }
            XCTAssertGreaterThanOrEqual(input.bounds.height, 111)
            XCTAssertLessThan(input.bounds.height, 240, "The Save row must remain visible below the body")
            XCTAssertTrue(input.becomeFirstResponder())
            input.selectedRange = NSRange(location: input.text.utf16.count, length: 0)
            input.insertText("\n末尾🙂")
            try await Task.sleep(nanoseconds: 100_000_000)
            XCTAssertEqual(actions.last?.action, "body")
            XCTAssertEqual(actions.last?.value, .string("Remember\n末尾🙂"))
        }
    }

    @MainActor private func textView(in view: UIView) -> UITextView? {
        if let input = view as? UITextView { return input }
        return view.subviews.lazy.compactMap { self.textView(in: $0) }.first
    }
}
#endif
