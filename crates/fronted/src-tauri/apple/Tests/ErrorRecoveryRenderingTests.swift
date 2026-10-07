import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

@MainActor
private final class RecoveryActions {
    var values: [XgentAction] = []
    func record(_ action: XgentAction) { values.append(action) }
}

final class ErrorRecoveryRenderingTests: XCTestCase {
    @MainActor
    func testRecoveryActionsUseSharedBridgeAndDisabledCopiesCannotRun() throws {
        let model = XgentPresentationModel(), actions = RecoveryActions()
        model.actionSink = actions.record
        let initial = try document(mode: "sheet", appearance: "dark")
        model.update(initial)
        model.send(try XCTUnwrap(initial.node(id: "error:reload")), in: initial)
        model.send(try XCTUnwrap(initial.node(id: "error:copy")), in: initial)
        model.send(try XCTUnwrap(initial.node(id: "error:copy")), in: initial)
        model.dismiss(initial)
        XCTAssertEqual(actions.values.map(\.action), ["error:reload", "error:copy", "error:close"])
        let disabled = try document(mode: "sheet", appearance: "dark", revision: 2, copying: true)
        model.update(disabled)
        model.send(try XCTUnwrap(initial.node(id: "error:copy")), in: initial)
        XCTAssertEqual(actions.values.count, 3)
        model.invalidate()
        model.send(try XCTUnwrap(disabled.node(id: "error:reload")), in: disabled)
        XCTAssertEqual(actions.values.count, 3)
    }

    @MainActor
    func testRecoveryRootAndSettingsRenderAtNarrowWideAndAccessibilitySizes() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        #else
        let widths: [CGFloat] = [640, 1040]
        #endif
        for width in widths {
            for mode in ["root", "sheet"] {
                for size in [DynamicTypeSize.large, .accessibility3] {
                    let appearance = size == .large ? "light" : "dark"
                    let document = try document(mode: mode, appearance: appearance)
                    let model = XgentPresentationModel()
                    model.update(document)
                    #if os(iOS)
                    let content = Group {
                        if mode == "sheet" {
                            XgentIOSSheetPresentation(initialDocument: document, model: model)
                        } else {
                            XgentIOSPagePresentation(document: document, sidebar: nil, model: model)
                        }
                    }
                    #else
                    let content = Group {
                        if mode == "sheet" {
                            ScrollView { XgentNodeChildren(nodes: document.nodes, document: document, model: model) }
                        } else {
                            XgentNodeChildren(nodes: document.nodes, document: document, model: model)
                        }
                    }
                    #endif
                    let view = content.frame(width: width, height: 720)
                        .dynamicTypeSize(size)
                        .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: document.appearance))
                        .preferredColorScheme(document.colorScheme)
                    #if os(iOS)
                    let hosting = UIHostingController(rootView: view)
                    hosting.view.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                    hosting.view.layoutIfNeeded()
                    let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(hosting.view).run { continuation.resume(returning: $0) }
                    }
                    XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 2_000)
                    #else
                    let hosting = NSHostingView(rootView: view)
                    hosting.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                    hosting.layoutSubtreeIfNeeded()
                    let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(hosting).run { continuation.resume(returning: $0) }
                    }
                    XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 2_000)
                    #endif
                    XCTAssertEqual(image.size.width, width)
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "error-recovery-\(mode)-\(Int(width))-\(appearance)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
        }
    }

    private func document(mode: String, appearance: String, revision: Int = 1,
                          copying: Bool = false) throws -> XgentDocument {
        let nodes: [[String: Any]] = [[
            "id": "error:screen", "kind": "Banner", "variant": "error-screen",
            "label": "Something went wrong", "status": "error",
            "text": "The provider settings could not be displayed. Reload the application or close settings and return to your conversation.",
            "children": [
                ["id": "error:reload", "kind": "Button", "label": "Reload", "action": "error:reload", "prominent": true],
                ["id": "error:copy", "kind": "Button", "label": "Copy error details", "action": "error:copy", "disabled": copying],
                ["id": "error:close", "kind": "Button", "label": "Close settings", "action": "error:close"],
                ["id": "error:feedback", "kind": "Text", "text": "Copy failed. Please try again.", "wrap": true],
                ["id": "error:diagnostics", "kind": "CodeBlock", "label": "Error details", "language": "text",
                 "text": "Error: Unable to render provider settings\n at ProviderSettings\n at App", "maxHeight": 240],
            ],
        ]]
        return try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "surface": "error-recovery", "revision": revision, "mode": mode,
            "title": "Something went wrong", "appearance": appearance,
            "formFactor": "mobile", "dismissAction": "error:close", "nodes": nodes,
        ]))
    }
}
