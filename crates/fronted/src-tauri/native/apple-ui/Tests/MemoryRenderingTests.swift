import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class MemoryRenderingTests: XCTestCase {
    @MainActor func testProjectMemoriesStartExpandedAndExposeUsableNativeEntryButtons() async throws {
        let review: [String: Any] = ["id": "review", "kind": "Badge", "label": "Awaiting review", "status": "pending"]
        let entry: [String: Any] = [
            "id": "memory-open", "kind": "NavigationRow", "variant": "memory-entry",
            "label": "Keep generated presentations and spreadsheets in the selected project workspace",
            "text": "Project · 2026-10-03", "action": "open", "children": [review],
        ]
        let project: [String: Any] = [
            "id": "project", "kind": "Collapsible", "variant": "memory-project", "label": "/Workspace (1)",
            "children": [entry],
        ]
        let payload: [String: Any] = [
            "version": 1, "surface": "memory-library", "revision": 1, "mode": "sheet",
            "title": "Memory", "appearance": "light", "nodes": [project],
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        let model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []
        model.actionSink = { action in
            actions.append(action)
            model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
        }
        defer { model.invalidate() }
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        #else
        let session = try NativeMacAccessibilitySession()
        defer { session.restore() }
        let widths: [CGFloat] = [480, 1040]
        #endif
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let content = ScrollView {
                    XgentNodeChildren(nodes: document.nodes, document: document, model: model).padding(16)
                }.frame(width: width, height: 720).dynamicTypeSize(size)
                    .environment(\.accessibilityEnabled, true)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                #if os(iOS)
                let host = UIHostingController(rootView: content)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 150_000_000)
                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                try attachNativeAccessibilityEvidence(hierarchy, name: "memory-library-\(Int(width))-\(size)")
                let entry = try XCTUnwrap(hierarchy.flattenToElements().first {
                    $0.identifier == "memory-open" && $0.traits.contains(.button)
                })
                let bounds = entry.shape.bezierPath.bounds
                XCTAssertGreaterThanOrEqual(bounds.height, 43.5)
                XCTAssertGreaterThanOrEqual(bounds.minX, -1)
                XCTAssertLessThanOrEqual(bounds.maxX, width + 1)
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                #else
                let host = NSHostingView(rootView: content)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 720),
                    styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host
                window.makeKeyAndOrderFront(nil)
                defer { window.close() }
                host.layoutSubtreeIfNeeded()
                try await Task.sleep(nanoseconds: 150_000_000)
                XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                let elements = nativeMacAccessibilityTree(host)
                try attachNativeAccessibilityEvidence(elements.map { [
                    "id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityLabel() ?? "",
                ] }, name: "memory-library-accessibility-\(Int(width))-\(size)")
                let entry = try XCTUnwrap(elements.first {
                    $0.accessibilityIdentifier() == "memory-open"
                })
                XCTAssertGreaterThanOrEqual(entry.accessibilityFrame().height, 43.5)
                let count = actions.count
                XCTAssertTrue(entry.accessibilityPerformPress())
                try await Task.sleep(nanoseconds: 30_000_000)
                XCTAssertEqual(actions.count, count + 1)
                XCTAssertEqual(actions.last?.action, "open")
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                #endif
                let attachment = XCTAttachment(image: image)
                attachment.name = "memory-library-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

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
