#if os(macOS)
import AppKit
import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class DesktopGitTests: XCTestCase {
    @MainActor func testGitNarrowNavigationAndWideSplitKeepCommitBarReachable() async throws {
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        for width in [CGFloat(360), 960] {
            let document = try fixture()
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { actions.append($0) }
            model.update(document)
            let host = NSHostingView(rootView: XgentNodeView(node: try XCTUnwrap(document.nodes.first), document: document, model: model)
                .environment(\.accessibilityEnabled, true)
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light)))
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 720),
                                  styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = host
            window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            try await Task.sleep(nanoseconds: 250_000_000)
            host.layoutSubtreeIfNeeded()
            var elements = accessibilityElements(host)
            try attachNativeAccessibilityEvidence(elements.map { ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityLabel() ?? ""] },
                name: "git-accessibility-\(Int(width))")
            let commit = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "git-commit" })
            let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
            let frame = commit.accessibilityFrame()
            XCTAssertGreaterThan(frame.height, 20)
            XCTAssertGreaterThanOrEqual(frame.minY, bounds.minY - 1)
            XCTAssertLessThanOrEqual(frame.maxY, bounds.maxY + 1)
            XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
            XCTAssertTrue(commit.accessibilityPerformPress())
            try await Task.sleep(nanoseconds: 100_000_000)
            XCTAssertEqual(actions.last?.action, "git-commit")
            if width < 620 {
                let detail = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "xgent-git-show-detail" })
                XCTAssertTrue(detail.accessibilityPerformPress())
                try await Task.sleep(nanoseconds: 100_000_000)
                elements = accessibilityElements(host)
                XCTAssertTrue(elements.contains { $0.accessibilityIdentifier() == "desktop-git-detail" })
                let list = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "xgent-git-show-list" })
                XCTAssertTrue(list.accessibilityPerformPress())
            } else {
                XCTAssertTrue(elements.contains { $0.accessibilityIdentifier() == "xgent-git-split" })
            }
            let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
            let image = await withCheckedContinuation { continuation in
                strategy.snapshot(host).run { continuation.resume(returning: $0) }
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "desktop-git-\(Int(width))"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    func testGitGraphDecodesSharedMergeTopologyAndRejectsInvalidColumn() throws {
        let graph: [String: Any] = ["kind": "commit", "sha": "merge", "parents": ["main", "topic"],
            "commitCol": 0, "commitColor": 0,
            "inputLanes": [["id": "merge", "color": 0]],
            "outputLanes": [["id": "main", "color": 0], ["id": "topic", "color": 1]],
            "isHead": true, "isMerge": true]
        let text = String(decoding: try JSONSerialization.data(withJSONObject: graph), as: UTF8.self)
        let row = try XCTUnwrap(XgentGitGraphRow.decode(text))
        XCTAssertEqual(row.parents, ["main", "topic"])
        XCTAssertEqual(row.columns, 2)
        XCTAssertTrue(row.isMerge)
        var invalid = graph
        invalid["commitCol"] = Int.max
        XCTAssertNil(XgentGitGraphRow.decode(String(decoding: try JSONSerialization.data(withJSONObject: invalid), as: UTF8.self)))
        XCTAssertNil(XgentGitGraphRow.decode("{}"))
    }

    @MainActor private func accessibilityElements(_ root: Any) -> [NativeMacAccessibilityElement] {
        nativeMacAccessibilityTree(root)
    }

    private func fixture() throws -> XgentDocument {
        let rows: [[String: Any]] = (0..<80).map { index in
            ["id": "change:\(index)", "kind": "NavigationRow", "label": "Sources/Directory/file-\(index).swift",
             "action": "select:\(index)", "icon": "doc.text"]
        }
        let payload: [String: Any] = ["version": 1, "surface": "git", "revision": 1,
            "mode": "root", "title": "Git Review", "appearance": "light", "formFactor": "desktop",
            "nodes": [["id": "desktop-git-layout", "kind": "VStack", "fill": true, "children": [
                ["id": "desktop-git-toolbar", "kind": "VStack", "padding": 12, "children": [
                    ["id": "header", "kind": "Heading", "text": "main · origin/main"],
                    ["id": "git-view", "kind": "SegmentedControl", "label": "Review", "value": "changes", "action": "view",
                     "options": [["value": "changes", "label": "Changes"], ["value": "history", "label": "History"]]],
                ]],
                ["id": "desktop-git-list", "kind": "VStack", "label": "Files", "children": rows],
                ["id": "desktop-git-detail", "kind": "VStack", "label": "Diff", "children": [
                    ["id": "git-diff-title", "kind": "Text", "text": ""],
                    ["id": "patch", "kind": "CodeBlock", "language": "diff", "text": String(repeating: "@@ -1 +1 @@\n-old\n+new\n", count: 80)],
                ]],
                ["id": "desktop-git-commit", "kind": "HStack", "children": [
                    ["id": "git-commit-message", "kind": "TextInput", "label": "Commit message", "value": "Fix native Git", "action": "message", "fill": true],
                    ["id": "git-commit", "kind": "Button", "label": "Commit", "action": "git-commit"],
                ]],
            ]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
#endif
