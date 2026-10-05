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

final class SidebarConversationRenderingTests: XCTestCase {
    @MainActor
    func testConversationMenusRemainSeparateFromLongTitlesAtNarrowAndAccessibleWidths() async throws {
        let cases: [(workspace: Bool, width: CGFloat, archived: Bool)] = [
            (false, 240, false), (false, 320, false), (true, 240, false), (true, 320, false),
            (true, 240, true), (true, 320, true),
        ]
        for (workspace, width, archived) in cases {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture(workspace: workspace, archived: archived)
                let model = XgentPresentationModel()
                model.update(document)
                let view = ScrollView {
                    VStack(spacing: 8) {
                        ForEach(document.nodes) { node in
                            #if os(iOS)
                            XgentIOSNode(node: node, document: document, model: model)
                            #else
                            XgentNodeView(node: node, document: document, model: model)
                            #endif
                        }
                    }.padding(12)
                }
                .frame(width: width, height: 720)
                .dynamicTypeSize(size)
                .background { XgentThemeBackground() }
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: size == .large ? .light : .dark))
                #if os(iOS)
                let host = UIHostingController(rootView: view)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 300_000_000)
                // SnapshotTesting's UIView strategy reparents then removes
                // this view. Parse while it is still mounted in its real host.
                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                #else
                let host = NSHostingView(rootView: view)
                let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 720),
                                      styleMask: [.borderless], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host
                window.makeKeyAndOrderFront(nil)
                defer { window.close() }
                host.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                try await Task.sleep(nanoseconds: 300_000_000)
                host.layoutSubtreeIfNeeded()
                let elements = nativeMacAccessibilityTree(host)
                for id in ["selected", "running", "ordinary"] {
                    let selection = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == id })
                    let menu = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "\(id):menu" })
                    XCTAssertLessThanOrEqual(selection.accessibilityFrame().maxX, menu.accessibilityFrame().minX + 1)
                    if workspace && !archived {
                        let disclosure = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "\(id):disclosure" })
                        XCTAssertGreaterThanOrEqual(disclosure.accessibilityFrame().width, 43.5)
                        XCTAssertLessThanOrEqual(disclosure.accessibilityFrame().maxX, selection.accessibilityFrame().minX + 1)
                        var actions: [XgentAction] = []
                        model.actionSink = { actions.append($0) }
                        XCTAssertTrue(disclosure.accessibilityPerformPress())
                        try await Task.sleep(nanoseconds: 50_000_000)
                        let action = try XCTUnwrap(actions.last)
                        XCTAssertEqual(action.action, "\(id):disclosure")
                        model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true))
                    }
                }
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                #endif
                let attachment = XCTAttachment(image: image)
                attachment.name = "sidebar-\(archived ? "archived" : workspace ? "workspace" : "conversation")-actions-\(Int(width))-\(size == .large ? "standard" : "large-dark")"
                attachment.lifetime = .keepAlways
                add(attachment)
                #if os(iOS)
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                encoder.nonConformingFloatEncodingStrategy = .convertToString(
                    positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
                let diagnostic = XCTAttachment(string: String(decoding: try encoder.encode(hierarchy), as: UTF8.self))
                diagnostic.name = "sidebar-AX-\(Int(width))-\(size == .large ? "standard" : "large-dark")"
                diagnostic.lifetime = .keepAlways
                add(diagnostic)
                let elements = hierarchy.flattenToElements()
                for id in ["selected", "running", "ordinary"] {
                    let selection = try XCTUnwrap(elements.first { $0.identifier == id && $0.traits.contains(.button) })
                    let menu = try XCTUnwrap(elements.first { $0.identifier == "\(id):menu" && $0.traits.contains(.button) })
                    XCTAssertEqual(selection.traits.contains(.notEnabled), archived)
                    XCTAssertFalse(menu.traits.contains(.notEnabled), "Archiving must preserve a usable restore menu")
                    let selectionFrame = selection.shape.bezierPath.bounds
                    let menuFrame = menu.shape.bezierPath.bounds
                    XCTAssertGreaterThanOrEqual(selectionFrame.height, 43.5)
                    XCTAssertLessThanOrEqual(selectionFrame.height, 720.0 / 3,
                        "A long title must leave room for the other conversations at large text sizes")
                    XCTAssertGreaterThanOrEqual(menuFrame.height, 43.5)
                    XCTAssertLessThanOrEqual(selectionFrame.maxX, menuFrame.minX + 1)
                    XCTAssertLessThanOrEqual(menuFrame.maxX, width + 1)
                    if workspace && !archived {
                        let disclosure = try XCTUnwrap(elements.first {
                            $0.identifier == "\(id):disclosure" && $0.traits.contains(.button)
                        })
                        let frame = disclosure.shape.bezierPath.bounds
                        XCTAssertGreaterThanOrEqual(frame.width, 43.5)
                        XCTAssertGreaterThanOrEqual(frame.height, 43.5)
                        XCTAssertLessThanOrEqual(frame.maxX, selectionFrame.minX + 1)
                        XCTAssertFalse(disclosure.traits.contains(.notEnabled))
                    }
                    for element in [selection, menu] {
                        let point = CGPoint(x: CGFloat(element.activationPoint.x), y: CGFloat(element.activationPoint.y))
                        XCTAssertTrue(point.x.isFinite && point.y.isFinite, "Activation coordinates must be finite")
                        XCTAssertTrue(element.shape.bezierPath.contains(point))
                    }
                }
                #endif
            }
        }
    }

    private func fixture(workspace: Bool = false, archived: Bool = false) throws -> XgentDocument {
        let nodes = ["selected", "running", "ordinary"].map { id -> [String: Any] in
            var children: [[String: Any]] = []
            if workspace && !archived {
                children.append(["id": "\(id):disclosure", "kind": "IconButton", "variant": "sidebar-disclosure",
                                 "icon": "chevron.forward", "label": "Expand \(id)", "action": "\(id):disclosure"])
            }
            children.append(["id": "\(id):menu", "kind": "Menu", "variant": "compact", "icon": "ellipsis",
                             "label": "Actions for \(id)", "children": [
                ["id": "\(id):rename", "kind": "Button", "label": "Rename", "action": "\(id):rename", "disabled": id == "running"],
                ["id": "\(id):delete", "kind": "Button", "label": "Delete", "action": "\(id):delete", "destructive": true, "disabled": id == "running"],
            ]])
            return ["id": id, "kind": "NavigationRow", "variant": workspace ? "sidebar-workspace-row" : "sidebar-conversation-row", "label": "\(id): Review browser results and prepare the workspace presentation",
             "action": id, "selected": id == "selected", "status": id == "running" ? "running" : "completed", "secondary": archived,
             "icon": "pin.fill", "children": children]
        }
        let payload: [String: Any] = ["version": 1, "surface": "conversation-actions", "revision": 1, "mode": "sidebar",
                                    "title": "Conversations", "appearance": "light", "nodes": nodes]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
