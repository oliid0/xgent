#if os(macOS)
import AppKit
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class DesktopRenderingTests: XCTestCase {
    @MainActor
    func testWorkEvidenceRemainsVisibleUntilTheRoundCompletes() async throws {
        let edited = node("edit", "ToolCall", [
            "label": "Edited workspace file", "text": "src/settings/ProviderConnection.swift",
            "variant": "timeline", "status": "completed", "children": [
                node("diff", "CodeBlock", ["label": "ProviderConnection.swift +2 -1", "language": "diff",
                                          "text": "@@ -1,2 +1,3 @@\n-old setting\n+new setting\n+verified setting"]),
            ],
        ])
        let checking = node("verify", "ToolCall", [
            "label": "Checking the change", "text": "Running the relevant checks",
            "variant": "timeline", "status": "running", "children": [
                node("command", "CodeBlock", ["label": "Command", "language": "shell", "text": "pnpm check"]),
            ],
        ])
        let live = try document(nodes: [
            node("summary", "Text", ["text": "I found the settings behavior and am checking the fix."]),
            edited, checking,
        ])
        let completed = try document(nodes: [
            node("finished", "Collapsible", ["label": "Worked for 2m 38s", "variant": "work",
                                            "children": [edited, checking]]),
            node("reply", "Text", ["text": "The settings change is complete."]),
        ])
        for (width, appearance) in [(CGFloat(640), "light"), (CGFloat(1040), "dark")] {
            let liveHeight = try await capture(live, name: "desktop-work-live-\(Int(width))",
                                               width: width, appearance: appearance)
            let completedHeight = try await capture(completed, name: "desktop-work-completed-\(Int(width))",
                                                    width: width, appearance: appearance)
            XCTAssertGreaterThan(liveHeight, completedHeight + 120,
                                 "Both finished and running tool evidence must render during work")
        }
    }

    @MainActor
    private func capture(_ document: XgentDocument, name: String, width: CGFloat,
                         appearance: String) async throws -> CGFloat {
        let model = XgentPresentationModel()
        model.update(document)
        let content = VStack(alignment: .leading, spacing: 12) {
            XgentNodeChildren(nodes: document.nodes, document: document, model: model)
        }
        .padding(20)
        .frame(width: width, alignment: .topLeading)
        .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: appearance))
        .preferredColorScheme(appearance == "dark" ? .dark : .light)
        let hosting = NSHostingView(rootView: content)
        hosting.frame = CGRect(x: 0, y: 0, width: width, height: 720)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(nanoseconds: 500_000_000)
        let height = hosting.fittingSize.height
        let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
        let image = await withCheckedContinuation { continuation in
            strategy.snapshot(hosting).run { continuation.resume(returning: $0) }
        }
        XCTAssertEqual(image.size.width, width)
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation)))
        let bytes = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        XCTAssertGreaterThan(bytes.count, 2_000, "Work screenshots must contain rendered content")
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        return height
    }

    private func node(_ id: String, _ kind: String, _ properties: [String: Any]) -> [String: Any] {
        properties.merging(["id": id, "kind": kind]) { _, value in value }
    }

    private func document(nodes: [[String: Any]]) throws -> XgentDocument {
        let json: [String: Any] = [
            "version": 1, "surface": "desktop-work", "revision": 1, "mode": "root",
            "title": "Work", "appearance": "light", "nodes": nodes,
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }
}
#endif
