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

final class MemoryRenderingTests: XCTestCase {
    @MainActor
    func testMemoryFormsRenderAtNarrowAndWideWidthsWithActualTimePicker() async throws {
        let nodes: [[String: Any]] = [[
            "id": "memory-models", "kind": "SettingsGroup", "label": "Memory models", "children": [
                ["id": "summary", "kind": "Selector", "label": "Conversation summary model", "value": "follow", "action": "summary",
                 "options": [["value": "follow", "label": "Follow the conversation model"]]],
                ["id": "organizer", "kind": "Switch", "label": "Organize memory automatically", "value": true, "action": "organizer"],
                ["id": "time", "kind": "TimeInput", "label": "Schedule time", "value": "23:59", "action": "time"],
                ["id": "quota", "kind": "Text", "text": "Project memories: 83 / 100. Review older entries before adding more."],
            ],
        ], [
            "id": "entry", "kind": "SettingsGroup", "label": "Project preference", "children": [
                ["id": "description", "kind": "TextInput", "label": "Description", "value": "Keep task results in the selected workspace", "action": "description"],
                ["id": "body", "kind": "TextArea", "label": "Memory body", "value": "Use the project's established output folder.\nConfirm the generated document exists.", "language": "markdown", "action": "body"],
                ["id": "save", "kind": "Button", "label": "Save memory", "action": "save"],
            ],
        ]]
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        #else
        let widths: [CGFloat] = [640, 1040]
        #endif
        for width in widths {
            for appearance in [XgentDocument.Appearance.light, .dark] {
                let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: [
                    "version": 1, "surface": "memory-render", "revision": 1, "mode": "sheet", "title": "Memory",
                    "appearance": appearance.rawValue, "nodes": nodes,
                ]))
                let model = XgentPresentationModel()
                model.update(document)
                let content = ScrollView {
                    XgentNodeChildren(nodes: document.nodes, document: document, model: model).padding(16)
                }.frame(width: width, height: 720)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: appearance))
                    .preferredColorScheme(appearance == .dark ? .dark : .light)
                #if os(iOS)
                let hosting = UIHostingController(rootView: content)
                hosting.view.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                hosting.view.layoutIfNeeded()
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(hosting.view).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 2_000)
                #else
                let hosting = NSHostingView(rootView: content)
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
                attachment.name = "memory-form-\(Int(width))-\(appearance.rawValue)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }
}
