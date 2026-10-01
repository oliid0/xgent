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
        for width in [CGFloat(240), 320] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let document = try fixture()
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
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: size == .large ? .light : .dark))
                .background { XgentThemeBackground() }
                #if os(iOS)
                let host = UIHostingController(rootView: view)
                host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                window.rootViewController = host
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 300_000_000)
                let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view).flattenToElements()
                for id in ["selected", "running", "ordinary"] {
                    let selection = try XCTUnwrap(elements.first { $0.identifier == id && $0.traits.contains(.button) })
                    let menu = try XCTUnwrap(elements.first { $0.identifier == "\(id):menu" && $0.traits.contains(.button) })
                    guard case let .frame(selectionFrame) = selection.shape, case let .frame(menuFrame) = menu.shape else {
                        XCTFail("Selection and menu need independent activation bounds")
                        continue
                    }
                    XCTAssertGreaterThanOrEqual(selectionFrame.height, 43.5)
                    XCTAssertGreaterThanOrEqual(menuFrame.height, 43.5)
                    XCTAssertLessThanOrEqual(selectionFrame.maxX, menuFrame.minX + 1)
                    XCTAssertLessThanOrEqual(CGFloat(menuFrame.maxX), width + 1)
                }
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                }
                #else
                let host = NSHostingView(rootView: view)
                host.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                host.layoutSubtreeIfNeeded()
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(host).run { continuation.resume(returning: $0) }
                }
                #endif
                let attachment = XCTAttachment(image: image)
                attachment.name = "sidebar-actions-\(Int(width))-\(size == .large ? "standard" : "large-dark")"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    private func fixture() throws -> XgentDocument {
        let nodes = ["selected", "running", "ordinary"].map { id -> [String: Any] in
            ["id": id, "kind": "NavigationRow", "variant": "sidebar-conversation-row", "label": "\(id): Review browser results and prepare the workspace presentation",
             "action": id, "selected": id == "selected", "status": id == "running" ? "running" : "completed",
             "icon": "pin.fill", "children": [["id": "\(id):menu", "kind": "Menu", "variant": "compact", "icon": "ellipsis", "label": "Actions for \(id)", "children": [
                ["id": "\(id):rename", "kind": "Button", "label": "Rename", "action": "\(id):rename", "disabled": id == "running"],
                ["id": "\(id):delete", "kind": "Button", "label": "Delete", "action": "\(id):delete", "destructive": true, "disabled": id == "running"],
             ]]]]
        }
        let payload: [String: Any] = ["version": 1, "surface": "conversation-actions", "revision": 1, "mode": "sidebar",
                                    "title": "Conversations", "appearance": "light", "nodes": nodes]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
