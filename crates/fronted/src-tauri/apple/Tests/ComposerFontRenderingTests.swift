import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class ComposerFontRenderingTests: XCTestCase {
    @MainActor func testComposerAndSearchApplyTheSelectedFontAndApplicationScale() async throws {
        let family = "Helvetica Neue"
        let expectedName = try XCTUnwrap(XgentFonts.name(for: family))
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "font-controls", "revision": 1, "mode": "root", "title": "Chat", "appearance": "light",
            "nodes": [
                ["id": "draft", "kind": "ComposerInput", "label": "Message", "value": "Font sample", "action": "draft"],
                ["id": "search", "kind": "VStack", "children": [
                    ["id": "workspace-search-query", "kind": "TextInput", "label": "Search", "value": "Search sample", "action": "query"],
                    ["id": "workspace-search-results", "kind": "List", "children": []],
                ]],
            ],
        ]))
        try document.validate()
        let base = XgentPresentationTheme.fallback
        for scale in [1.0, 1.4] {
            let theme = XgentPresentationTheme(light: base.light, dark: base.dark, radius: base.radius,
                spacing: base.spacing, control: base.control, typography: base.typography,
                motion: base.motion, material: base.material, fontScale: scale,
                fontFamily: family, codeFontFamily: base.codeFontFamily)
            let model = XgentPresentationModel(); model.update(document)
            let content = VStack {
                XgentComposerInput(node: document.nodes[0], document: document, model: model)
                XgentWorkspaceSearchPalette(node: document.nodes[1], document: document, model: model)
            }.frame(width: 320, height: 620)
                .environment(\.xgentPresentationTheme, theme).dynamicTypeSize(.large)
            #if os(iOS)
            let host = UIHostingController(rootView: content)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 620))
            window.rootViewController = host; window.makeKeyAndVisible()
            defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded(); try await Task.sleep(nanoseconds: 180_000_000)
            func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap { descendants($0) } }
            let views = descendants(host.view)
            let composer = try XCTUnwrap(views.compactMap { $0 as? UITextView }.first { $0.text == "Font sample" })
            let query = try XCTUnwrap(views.compactMap { $0 as? UITextField }.first { $0.text == "Search sample" })
            let fonts = [try XCTUnwrap(composer.font), try XCTUnwrap(query.font)]
            let expectedSize = 17.0 * scale
            #else
            let host = NSHostingView(rootView: content)
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 320, height: 620),
                styleMask: [.titled], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            host.layoutSubtreeIfNeeded(); try await Task.sleep(nanoseconds: 180_000_000)
            func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap { descendants($0) } }
            let views = descendants(host)
            let fields = views.compactMap { $0 as? NSTextField }
            let composer = try XCTUnwrap(views.compactMap { $0 as? NSTextView }.first { $0.string == "Font sample" })
            let query = try XCTUnwrap(fields.first { $0.stringValue == "Search sample" })
            let fonts = [try XCTUnwrap(composer.font), try XCTUnwrap(query.font)]
            let expectedSize = base.typography.body * scale
            #endif
            for font in fonts {
                XCTAssertEqual(font.fontName, expectedName)
                XCTAssertEqual(Double(font.pointSize), expectedSize, accuracy: 0.5,
                    "The selected application font scale applies once to each real native input")
            }
        }
    }
}
