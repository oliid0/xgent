import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class WorkspaceSearchRenderingTests: XCTestCase {
    @MainActor func testSearchInputAndLongResultsFitNarrowAndAccessibleLayouts() async throws {
        #if os(macOS)
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        #endif
        for size in [DynamicTypeSize.large, .accessibility3] {
            let document = try fixture(count: 18)
            let model = XgentPresentationModel(); model.update(document)
            var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
            let content = XgentWorkspaceSearchPalette(node: document.nodes[0], document: document, model: model)
                .frame(width: 320, height: 620).dynamicTypeSize(size)
            #if os(iOS)
            let host = UIHostingController(rootView: content); host.safeAreaRegions = []
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 620))
            window.rootViewController = host; window.makeKeyAndVisible()
            defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
            host.view.layoutIfNeeded(); try await Task.sleep(nanoseconds: 180_000_000)
            let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
            let elements = hierarchy.flattenToElements()
            try attachNativeAccessibilityEvidence(hierarchy, name: "workspace-search-before-checks-320-\(size)")
            try attachCompositedNativeScreenshot(of: host.view, name: "workspace-search-before-checks-320-\(size)")
            let query = try XCTUnwrap(elements.first { $0.identifier == "workspace-search-query" })
            let first = try XCTUnwrap(elements.first { $0.identifier == "workspace-search-result:0" })
            let queryFrame = query.shape.bezierPath.bounds, firstFrame = first.shape.bezierPath.bounds
            XCTAssertFalse(queryFrame.intersects(firstFrame))
            XCTAssertGreaterThanOrEqual(firstFrame.height, 44)
            for frame in [queryFrame, firstFrame] {
                XCTAssertGreaterThanOrEqual(frame.minX, -1); XCTAssertLessThanOrEqual(frame.maxX, 321)
            }
            try attachNativeAccessibilityEvidence(hierarchy, name: "workspace-search-320-\(size)")
            try attachCompositedNativeScreenshot(of: host.view, name: "workspace-search-320-\(size)")
            func fields(_ view: UIView) -> [UITextField] {
                (view as? UITextField).map { [$0] } ?? view.subviews.flatMap { fields($0) }
            }
            let input = try XCTUnwrap(fields(host.view).first)
            XCTAssertTrue(input.becomeFirstResponder()); input.insertText("report")
            try await Task.sleep(nanoseconds: 80_000_000)
            XCTAssertEqual(actions.last?.action, "search-query")
            XCTAssertEqual(actions.last?.value.text, "report")
            #else
            let host = NSHostingView(rootView: content)
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 320, height: 620),
                                  styleMask: [.titled], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            host.layoutSubtreeIfNeeded(); try await Task.sleep(nanoseconds: 180_000_000)
            let elements = nativeMacAccessibilityTree(window)
            // Keep real diagnostics even when a required native element is missing.
            try attachNativeAccessibilityEvidence(elements.map { ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityLabel() ?? "",
                "role": $0.accessibilityRole()?.rawValue ?? "", "frame": NSStringFromRect($0.accessibilityFrame())] },
                name: "workspace-search-tree-320-\(size)")
            let before = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds)); host.cacheDisplay(in: host.bounds, to: before)
            let beforeAttachment = XCTAttachment(image: NSImage(cgImage: try XCTUnwrap(before.cgImage), size: host.bounds.size))
            beforeAttachment.name = "workspace-search-before-checks-320-\(size)"; beforeAttachment.lifetime = .keepAlways; add(beforeAttachment)
            let query = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "workspace-search-query" })
            let first = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "workspace-search-result:0" })
            XCTAssertFalse(query.accessibilityFrame().intersects(first.accessibilityFrame()))
            XCTAssertGreaterThanOrEqual(first.accessibilityFrame().height, 44)
            let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
            for frame in [query.accessibilityFrame(), first.accessibilityFrame()] {
                XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1); XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
            }
            XCTAssertTrue(first.accessibilityPerformPress()); try await Task.sleep(nanoseconds: 60_000_000)
            XCTAssertEqual(actions.last?.action, "result:0")
            try attachNativeAccessibilityEvidence(elements.map { ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityLabel() ?? ""] },
                name: "workspace-search-320-\(size)")
            let image = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds)); host.cacheDisplay(in: host.bounds, to: image)
            let attachment = XCTAttachment(image: NSImage(cgImage: try XCTUnwrap(image.cgImage), size: host.bounds.size))
            attachment.name = "workspace-search-320-\(size)"; attachment.lifetime = .keepAlways; add(attachment)
            #endif
        }
    }

    #if os(macOS)
    @MainActor func testActualKeyboardNavigatesResultsAndReturnDispatchesSelection() async throws {
        let accessibility = try NativeMacAccessibilitySession(); defer { accessibility.restore() }
        let document = try fixture(count: 3)
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let host = NSHostingView(rootView: XgentWorkspaceSearchPalette(node: document.nodes[0], document: document, model: model))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 640, height: 560),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        host.layoutSubtreeIfNeeded(); try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertNotNil(window.firstResponder as? NSTextView, "Search must focus the native field editor")
        func press(_ code: UInt16, _ characters: String) throws {
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                window.sendEvent(try XCTUnwrap(NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [], timestamp: 0,
                    windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters,
                    isARepeat: false, keyCode: code)))
            }
        }
        try press(125, "\u{f701}"); try await Task.sleep(nanoseconds: 50_000_000)
        try press(125, "\u{f701}"); try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertTrue(actions.isEmpty, "Arrows select locally without executing a result")
        try press(36, "\r"); try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(actions.last?.action, "result:1")
    }
    #endif

    private func fixture(count: Int) throws -> XgentDocument {
        #if os(iOS)
        let formFactor = "mobile"
        #else
        let formFactor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "search", "revision": 1, "mode": "sheet",
            "title": "Search", "appearance": "light", "formFactor": formFactor, "dismissAction": "close",
            "nodes": [["id": "workspace-search-palette", "kind": "VStack", "variant": "workspace-search-palette", "fill": true,
                       "children": [
                ["id": "workspace-search-query", "kind": "TextInput", "label": "Search messages, files and settings", "value": "", "action": "search-query"],
                ["id": "workspace-search-close", "kind": "IconButton", "label": "Close", "action": "close"],
                ["id": "workspace-search-results", "kind": "List", "children": [["id": "files", "kind": "VStack", "label": "Workspace files",
                    "children": (0..<count).map { index in ["id": "workspace-search-result:\(index)", "kind": "NavigationRow", "icon": "doc",
                        "label": "\(index) /workspace/long-folder-name/another-folder/quarterly-report-with-a-readable-title.md",
                        "text": "A matching message or file path, with details that can wrap on a narrow phone.", "action": "result:\(index)"] }]],
                ],
            ]]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate(); return document
    }
}
