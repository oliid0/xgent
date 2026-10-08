#if os(macOS)
import AppKit
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class DesktopRenderingTests: XCTestCase {
    @MainActor
    func testWorkEvidenceRemainsVisibleUntilTheRoundCompletes() async throws {
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
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
        let liveNodes = [
            node("summary", "Text", ["text": "I found the settings behavior and am checking the fix."]),
            edited, checking,
        ]
        let completedNodes = [
            node("finished", "Collapsible", ["label": "Worked for 2m 38s", "variant": "work",
                                            "children": [edited, checking]]),
            node("reply", "Text", ["text": "The settings change is complete."]),
        ]
        for (width, appearance) in [(CGFloat(640), XgentDocument.Appearance.light), (CGFloat(1040), .dark)] {
            let live = try document(nodes: [node("live:work", "Section", ["label": "Working", "children": liveNodes])], appearance: appearance)
            let completed = try document(nodes: completedNodes, appearance: appearance)
            try await capture(live, name: "desktop-work-live-\(Int(width))",
                              width: width, appearance: appearance, active: true)
            try await capture(completed, name: "desktop-work-completed-\(Int(width))",
                              width: width, appearance: appearance, active: false)
        }
    }

    @MainActor
    private func capture(_ document: XgentDocument, name: String, width: CGFloat,
                         appearance: XgentDocument.Appearance, active: Bool) async throws {
        let model = XgentPresentationModel()
        model.update(document)
        let content = VStack(alignment: .leading, spacing: 12) {
            XgentNodeChildren(nodes: document.nodes, document: document, model: model)
        }
        .padding(20)
        .frame(width: width, alignment: .topLeading)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color(xgentHex: XgentPresentationTheme.fallback.palette(for: appearance == .dark ? .dark : .light).background))
        .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: appearance))
        .preferredColorScheme(appearance == .dark ? .dark : .light)
        let hosting = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 720),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = hosting; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(nanoseconds: 500_000_000)
        func elements() -> [NativeMacAccessibilityElement] { nativeMacAccessibilityTree(window) }
        XCTAssertFalse(elements().contains { $0.accessibilityText()?.contains("pnpm check") == true },
                       "Detailed evidence starts folded while summaries remain readable")
        if active {
            for text in ["Edited workspace file", "src/settings/ProviderConnection.swift",
                         "Checking the change", "Running the relevant checks"] {
                XCTAssertTrue(elements().contains { $0.accessibilityText()?.contains(text) == true },
                              "Active work retains the summary: \(text)")
            }
            for id in ["edit:disclosure", "verify:disclosure"] {
                let disclosure = try XCTUnwrap(elements().first {
                    $0.accessibilityIdentifier() == id && $0.accessibilityRole() == .disclosureTriangle
                })
                XCTAssertTrue(disclosure.accessibilityPerformPress())
                try await Task.sleep(for: .milliseconds(150))
            }
            for text in ["ProviderConnection.swift +2 -1", "verified setting", "pnpm check"] {
                XCTAssertTrue(elements().contains { $0.accessibilityText()?.contains(text) == true },
                              "Finished and running evidence remains reachable: \(text)")
            }
        } else {
            XCTAssertTrue(elements().contains { $0.accessibilityText()?.contains("Worked for 2m 38s") == true })
            XCTAssertTrue(elements().contains { $0.accessibilityText()?.contains("The settings change is complete.") == true })
            XCTAssertFalse(elements().contains { $0.accessibilityIdentifier() == "edit:disclosure" },
                           "Completed work folds the round instead of occupying the reply")
        }
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
    }

    private func node(_ id: String, _ kind: String, _ properties: [String: Any]) -> [String: Any] {
        properties.merging(["id": id, "kind": kind]) { _, value in value }
    }

    private func document(nodes: [[String: Any]], appearance: XgentDocument.Appearance) throws -> XgentDocument {
        let json: [String: Any] = [
            "version": 1, "surface": "desktop-work", "revision": 1, "mode": "root",
            "title": "Work", "appearance": appearance.rawValue, "nodes": nodes,
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }
}
#endif
