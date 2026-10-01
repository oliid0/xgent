#if os(macOS)
import AppKit
import SnapshotTesting
import SwiftUI
import XCTest
@testable import XgentNativeUI

private struct WorkspaceMainProbe: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.identifier = NSUserInterfaceItemIdentifier("workspace-main-probe")
        return view
    }
    func updateNSView(_ view: NSView, context: Context) {}
}

final class WorkspacePanelRenderingTests: XCTestCase {
    @MainActor
    func testDockFitsBothWidthsAndHidesTheBrowserViewportWhenAnotherPanelOpens() async throws {
        for width in [CGFloat(640), CGFloat(1280)] {
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { action in
                actions.append(action)
                model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId,
                                                 ok: true, error: nil))
            }
            model.update(try panel("browser", nodes: [["id": "browser-layout", "kind": "BrowserLayout", "children": [
                ["id": "browser-viewport", "kind": "BrowserViewport", "label": "Browser content", "action": "viewport"],
            ]]]))
            let layout = XgentDesktopWorkspaceLayout(model: model, minimumMainWidth: 440, enabled: true) {
                VStack {
                    Text("Main conversation stays in its own pane")
                    WorkspaceMainProbe()
                }
            }
            .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
            let root = NSHostingView(rootView: layout)
            let size = CGSize(width: width, height: 720)
            root.frame = CGRect(origin: .zero, size: size)
            root.layoutSubtreeIfNeeded()
            try await Task.sleep(nanoseconds: 500_000_000)
            if width == 640 {
                XCTAssertNil(probe(root), "A narrow window must display one usable pane")
            } else {
                let main = try XCTUnwrap(probe(root))
                XCTAssertGreaterThanOrEqual(main.bounds.width, 439)
                let frame = main.convert(main.bounds, to: root)
                XCTAssertGreaterThanOrEqual(frame.minX, -1)
                XCTAssertLessThanOrEqual(frame.maxX, width - 359)
            }
            let viewportEvents = try actions.filter { $0.action == "viewport" }.map(viewport)
            let visible = try XCTUnwrap(viewportEvents.last { $0["visible"] as? Bool == true })
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(visible["width"] as? Double), 300)
            let strategy = Snapshotting<NSView, NSImage>.image(size: size)
            let image = await withCheckedContinuation { continuation in
                strategy.snapshot(root).run { continuation.resume(returning: $0) }
            }
            let bitmap = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation)))
            XCTAssertGreaterThan(try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).count, 1_500)
            let attachment = XCTAttachment(image: image)
            attachment.name = "workspace-dock-\(Int(width))"
            attachment.lifetime = .keepAlways
            add(attachment)
            model.update(try panel("files", nodes: [["id": "files", "kind": "Text", "text": "Workspace files"]]))
            root.layoutSubtreeIfNeeded()
            try await Task.sleep(nanoseconds: 300_000_000)
            let events = try actions.filter { $0.action == "viewport" }.map(viewport)
            XCTAssertEqual(events.last?["visible"] as? Bool, false,
                           "The backend WebKit overlay must hide when its panel loses visibility")
            model.invalidate()
        }
    }

    private func viewport(_ action: XgentAction) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(action.value.text.utf8)) as? [String: Any])
    }

    @MainActor private func probe(_ view: NSView) -> NSView? {
        if view.identifier?.rawValue == "workspace-main-probe" { return view }
        for child in view.subviews { if let found = probe(child) { return found } }
        return nil
    }

    private func panel(_ id: String, nodes: [[String: Any]]) throws -> XgentDocument {
        let data: [String: Any] = ["version": 1, "surface": id, "revision": 1, "mode": "panel",
                                 "title": id, "appearance": "light", "formFactor": "desktop", "nodes": nodes,
                                 "dismissAction": "close", "workspacePanel": ["focusRequest": 0,
                                 "openLabel": "Show panel", "returnLabel": "Return to chat",
                                 "expandLabel": "Expand", "restoreLabel": "Restore", "closeLabel": "Close panel"]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: data))
        try document.validate()
        return document
    }
}
#endif
