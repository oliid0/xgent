#if os(macOS)
import AppKit
import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class DesktopGitTests: XCTestCase {
    @MainActor func testGitVerticalAndHorizontalPanesKeepToolbarAndCommitReachable() async throws {
        let accessibilitySession = try NativeMacAccessibilitySession()
        defer { accessibilitySession.restore() }
        let cases: [(CGFloat, DynamicTypeSize)] = [(360, .large), (960, .large), (360, .accessibility3), (960, .accessibility3)]
        for (width, typeSize) in cases {
            let document = try fixture()
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { action in
                actions.append(action)
                model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
            }
            model.update(document)
            let host = NSHostingView(rootView: XgentNodeView(node: try XCTUnwrap(document.nodes.first), document: document, model: model)
                .environment(\.accessibilityEnabled, true)
                .dynamicTypeSize(typeSize)
                .background { XgentThemeBackground() }
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
                name: "git-accessibility-\(Int(width))-\(typeSize)")
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
            XCTAssertTrue(elements.contains { $0.accessibilityIdentifier() == (width < 620 ? "xgent-git-stack" : "xgent-git-split") })
            for id in ["desktop-git-list", "desktop-git-detail"] {
                XCTAssertTrue(elements.contains { $0.accessibilityIdentifier() == id })
            }
            for id in ["git-branches", "git-ai-review", "git-refresh", "git-fetch", "git-pull", "git-push", "git-close"] {
                let control = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == id && $0.accessibilityRole() == .button })
                let frame = control.accessibilityFrame()
                XCTAssertGreaterThanOrEqual(frame.height, 31.5)
                XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1)
                XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
                XCTAssertGreaterThanOrEqual(frame.minY, bounds.maxY - (typeSize.isAccessibilitySize ? 240 : 160),
                    "Compact toolbar actions must stay near the top without a 240-point scrollport")
                XCTAssertTrue(control.accessibilityPerformPress())
                try await Task.sleep(nanoseconds: 30_000_000)
                XCTAssertEqual(actions.last?.action, id)
            }
            let visibility = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "git-diff-visible" })
            XCTAssertTrue(visibility.accessibilityPerformPress())
            try await Task.sleep(nanoseconds: 100_000_000)
            XCTAssertEqual(actions.last?.action, "visibility")
            XCTAssertEqual(actions.last?.value, .bool(false))
            elements = accessibilityElements(host)
            XCTAssertTrue(elements.contains { $0.accessibilityIdentifier() == "desktop-git-list" })
            XCTAssertFalse(elements.contains { $0.accessibilityIdentifier() == "desktop-git-detail" })
            let show = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "git-diff-visible" })
            XCTAssertTrue(show.accessibilityPerformPress())
            try await Task.sleep(nanoseconds: 100_000_000)
            XCTAssertEqual(actions.last?.value, .bool(true))
            XCTAssertTrue(accessibilityElements(host).contains { $0.accessibilityIdentifier() == "desktop-git-detail" })
            let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
            let image = await withCheckedContinuation { continuation in
                strategy.snapshot(host).run { continuation.resume(returning: $0) }
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "desktop-git-\(Int(width))-\(typeSize)"
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
                    ["id": "git-header", "kind": "HStack", "children": [
                        ["id": "git-head", "kind": "Heading", "text": "main"],
                        ["id": "git-refresh", "kind": "Button", "label": "Refresh", "action": "git-refresh"],
                        ["id": "git-ai-review", "kind": "Button", "label": "AI review", "action": "git-ai-review"],
                        ["id": "git-close", "kind": "Button", "label": "Close", "action": "git-close"],
                    ]],
                    ["id": "git-controls", "kind": "HStack", "children": [
                        ["id": "git-branches", "kind": "Button", "label": "Switch branch", "action": "git-branches"],
                        ["id": "git-fetch", "kind": "Button", "label": "Fetch", "action": "git-fetch"],
                        ["id": "git-pull", "kind": "Button", "label": "Pull", "action": "git-pull"],
                        ["id": "git-push", "kind": "Button", "label": "Push", "action": "git-push"],
                    ]],
                    ["id": "git-summary", "kind": "Text", "secondary": true, "size": "small", "text": "origin/main · ↑1 ↓0 · Staged 1 · Unstaged 80"],
                    ["id": "git-view", "kind": "SegmentedControl", "label": "Review", "value": "changes", "action": "view",
                     "options": [["value": "changes", "label": "Changes"], ["value": "history", "label": "History"]]],
                    ["id": "git-diff-visible", "kind": "Switch", "label": "Hide or show diff", "value": true, "action": "visibility"],
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
