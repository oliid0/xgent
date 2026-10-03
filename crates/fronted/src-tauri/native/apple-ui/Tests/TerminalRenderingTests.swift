import SnapshotTesting
import SwiftUI
import SwiftTerm
import XCTest
#if os(iOS)
import UIKit
private typealias PlatformView = UIView
#else
import AppKit
private typealias PlatformView = NSView
#endif
@testable import XgentNativeUI

final class TerminalRenderingTests: XCTestCase {
    @MainActor
    func testTerminalViewportFitsNarrowWideAndAuthenticationLayouts() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        #else
        let widths: [CGFloat] = [360, 1040]
        #endif
        for width in widths {
            for challenge in [false, true] {
                let document = try fixture(dark: challenge, challenge: challenge)
                let model = XgentPresentationModel()
                model.update(document)
                let content = XgentTerminalLayout(node: try XCTUnwrap(document.nodes.first), document: document, model: model)
                    .dynamicTypeSize(challenge ? .accessibility3 : .large)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: document.appearance))
                    .preferredColorScheme(document.colorScheme)
                let size = CGSize(width: width, height: 640)
                #if os(iOS)
                let controller = UIHostingController(rootView: content)
                let window = UIWindow(frame: CGRect(origin: .zero, size: size))
                window.rootViewController = controller
                window.makeKeyAndVisible()
                controller.view.frame = window.bounds
                controller.view.layoutIfNeeded()
                defer { window.isHidden = true; window.rootViewController = nil }
                let root: PlatformView = controller.view
                #else
                let root = NSHostingView(rootView: content)
                root.frame = CGRect(origin: .zero, size: size)
                root.layoutSubtreeIfNeeded()
                #endif
                try await Task.sleep(nanoseconds: 500_000_000)
                let view = try XCTUnwrap(terminal(in: root))
                XCTAssertTrue(view.getTerminal().ansi256PaletteStrategy == .xterm)
                #if os(iOS)
                var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
                XCTAssertTrue(view.nativeForegroundColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
                #else
                let ink = try XCTUnwrap(view.nativeForegroundColor.usingColorSpace(.sRGB))
                let red = ink.redComponent, green = ink.greenComponent, blue = ink.blueComponent
                #endif
                XCTAssertEqual(red, CGFloat(challenge ? 0x4a : 0x1f) / 255, accuracy: 0.002)
                XCTAssertEqual(green, CGFloat(challenge ? 0xde : 0x29) / 255, accuracy: 0.002)
                XCTAssertEqual(blue, CGFloat(challenge ? 0x80 : 0x33) / 255, accuracy: 0.002)
                XCTAssertGreaterThanOrEqual(view.bounds.height, 290, "Forms must leave a usable terminal viewport")
                let frame = view.convert(view.bounds, to: root)
                XCTAssertGreaterThanOrEqual(frame.minX, -1)
                XCTAssertGreaterThanOrEqual(frame.minY, -1)
                XCTAssertLessThanOrEqual(frame.maxX, width + 1)
                XCTAssertLessThanOrEqual(frame.maxY, size.height + 1)
                XCTAssertTrue(String(decoding: view.getTerminal().getBufferAsData(), as: UTF8.self).contains("xgent-terminal-rendered"))
                #if os(iOS)
                let strategy = Snapshotting<UIViewController, UIImage>.image(size: size)
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(controller).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 2_000)
                #else
                let strategy = Snapshotting<NSView, NSImage>.image(size: size)
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(root).run { continuation.resume(returning: $0) }
                }
                let bitmap = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation)))
                XCTAssertGreaterThan(try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).count, 2_000)
                #endif
                let attachment = XCTAttachment(image: image)
                attachment.name = "terminal-\(Int(width))-\(challenge ? "authentication" : "output")"
                attachment.lifetime = .keepAlways
                add(attachment)
                model.invalidate()
            }
        }
    }

    @MainActor
    private func terminal(in view: PlatformView) -> TerminalView? {
        if let terminal = view as? TerminalView { return terminal }
        for child in view.subviews { if let terminal = terminal(in: child) { return terminal } }
        return nil
    }

    private func fixture(dark: Bool, challenge: Bool) throws -> XgentDocument {
        let output = Array("\u{1b}[32mxgent-terminal-rendered\u{1b}[0m\r\n$ pwd\r\n/workspace\r\n\u{1b}[31merror\u{1b}[0m \u{1b}[33mwarning\u{1b}[0m \u{1b}[38;5;21mindexed blue\u{1b}[0m\r\n$ ".utf8)
        let packet: [String: Any] = ["sessionId": "fixture", "generation": 1, "startOffset": 0,
                                   "endOffset": output.count, "bytes": Data(output).base64EncodedString(), "enabled": true]
        var chrome: [[String: Any]] = [
            ["id": "selectors", "kind": "TerminalToolbar", "variant": "terminal-connection-fields", "label": "Sessions", "padding": 12, "children": [
                ["id": "session", "kind": "Selector", "variant": "terminal-session-tabs", "label": "Session", "value": "fixture", "action": "session",
                 "options": [["value": "fixture", "label": "Workspace terminal"], ["value": "other", "label": "另一个文档制作终端"]]],
                ["id": "shell", "kind": "Selector", "label": "Shell", "value": "sh", "action": "shell",
                 "options": [["value": "sh", "label": "/bin/sh"]]],
            ]],
            ["id": "actions", "kind": "TerminalToolbar", "label": "Terminal actions", "padding": 12, "children": [
                ["id": "new", "kind": "Button", "label": "New Terminal", "action": "new"],
                ["id": "rename", "kind": "Button", "label": "Rename", "action": "rename"],
                ["id": "close", "kind": "Button", "label": "Close Terminal", "action": "close"],
            ]],
        ]
        if challenge {
            chrome.append(["id": "auth", "kind": "VStack", "padding": 12, "spacing": 8, "children": [
                ["id": "message", "kind": "Text", "text": String(repeating: "Confirm the server's host key before connecting. ", count: 10)],
                ["id": "fingerprint", "kind": "Text", "text": "SHA256:verified-host-key"],
                ["id": "password", "kind": "TextInput", "label": "Password", "value": "", "secure": true, "action": "password"],
                ["id": "continue", "kind": "Button", "label": "Continue connecting", "action": "continue"],
            ]])
        } else {
            chrome.append(["id": "terminal-rename-form", "kind": "VStack", "variant": "terminal-rename-editor", "padding": 12, "children": [
                ["id": "terminal-name", "kind": "TextInput", "label": "终端名称", "value": "文稿与表格制作", "action": "name"],
                ["id": "rename-actions", "kind": "HStack", "children": [
                    ["id": "terminal-name-save", "kind": "Button", "label": "重命名", "action": "save"],
                    ["id": "terminal-name-cancel", "kind": "Button", "label": "取消", "action": "cancel"]]]]])
        }
        chrome.append(["id": "viewport", "kind": "TerminalViewport", "label": "Terminal", "fill": true, "minHeight": 300,
                       "action": "events", "value": String(decoding: try JSONSerialization.data(withJSONObject: packet), as: UTF8.self)])
        let json: [String: Any] = ["version": 1, "surface": "terminal-render", "revision": 1, "mode": "root",
                                  "title": "Terminal", "appearance": dark ? "dark" : "light",
                                  "nodes": [["id": "layout", "kind": "TerminalLayout", "children": chrome]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }
}
