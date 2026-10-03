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

final class MermaidDiagramTests: XCTestCase {
    private func fixtures() throws -> [XgentDiagramReply] {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle(for: Self.self)
        #endif
        let url = try XCTUnwrap(bundle.url(forResource: "native-mermaid", withExtension: "json", subdirectory: "Fixtures") ??
            bundle.url(forResource: "native-mermaid", withExtension: "json"))
        return try JSONDecoder().decode([XgentDiagramReply].self, from: Data(contentsOf: url))
    }

    func testActualSharedSvgFixturesParseAndRasterizeWithTheirArrows() throws {
        let fixtures = try fixtures()
        XCTAssertEqual(fixtures.count, 10)
        for fixture in fixtures {
            guard let image = fixture.image(source: fixture.source, dark: fixture.dark) else {
                // SVG(data:) intentionally swallows its parser error. The file
                // initializer emits that actual SDK error for fixture diagnosis.
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("xgent-diagram-\(UUID.uuidString).svg")
                try fixture.svg?.data(using: .utf8)?.write(to: url)
                _ = SVG(fileURL: url)
                try FileManager.default.removeItem(at: url)
                XCTFail("The real shared SVG must parse: \(fixture.source), dark=\(fixture.dark)")
                continue
            }
            XCTAssertGreaterThan(image.size.width, 20); XCTAssertGreaterThan(image.size.height, 20)
            let data = try XCTUnwrap(fixture.svg?.data(using: .utf8))
            let decoder = try XCTUnwrap(XgentSVGImageDecoder(data: data, maximumPixelSize: 512))
            let rendered = try decoder.decode(data)
            XCTAssertGreaterThan(rendered.image.size.width, 20); XCTAssertGreaterThan(rendered.image.size.height, 20)
            XCTAssertNil(fixture.image(source: fixture.source + "changed", dark: fixture.dark))
            XCTAssertNil(fixture.image(source: fixture.source, dark: !fixture.dark))
        }
    }

    @MainActor func testDiagramUsesItsOwnActionAndRetiresOnReplacementAndCancellation() async throws {
        for operation in ["success", "replace", "cancel", "remove", "invalidate"] {
            let model = XgentPresentationModel(), document = try document()
            model.update(document)
            let emitted = expectation(description: operation)
            var actions: [XgentAction] = []
            model.actionSink = { actions.append($0); emitted.fulfill() }
            let node = try XCTUnwrap(document.node(id: "answer"))
            let pending = Task { await model.renderDiagram(node, in: document, source: "graph TD; A-->B", dark: true) }
            await fulfillment(of: [emitted], timeout: 2)
            let action = try XCTUnwrap(actions.first)
            XCTAssertEqual(action.action, "render")
            let input = try XCTUnwrap(action.value.text.data(using: .utf8))
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: input) as? [String: Any])
            XCTAssertEqual(payload["source"] as? String, "graph TD; A-->B")
            XCTAssertEqual(payload["dark"] as? Bool, true)
            XCTAssertTrue(model.busy.isEmpty); XCTAssertTrue(model.edits.isEmpty)
            switch operation {
            case "success":
                model.complete(.init(surface: "other", requestId: action.requestId, ok: true, error: nil, acceptedValue: .string("wrong")))
                model.complete(.init(surface: document.surface, requestId: action.requestId, ok: true, error: nil, acceptedValue: .string("svg")))
            case "replace": model.update(try self.document(revision: 2, diagramAction: "another"))
            case "cancel": pending.cancel()
            case "remove": model.update(try self.document(revision: 2, removed: true))
            default: model.invalidate()
            }
            let result = await pending.value
            XCTAssertEqual(result, operation == "success" ? "svg" : nil)
            XCTAssertTrue(model.busy.isEmpty); XCTAssertTrue(model.edits.isEmpty); XCTAssertNil(model.error)
            model.invalidate()
        }
    }

    @MainActor func testRealNativeMarkdownDiagramWidthsAndThemeReplies() async throws {
        #if os(macOS)
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        #endif
        let fixtures = try fixtures()
        for width: CGFloat in [320, 768] {
            for dark in [false, true] {
                let fixture = try XCTUnwrap(fixtures.first { $0.dark == dark })
                let rendered = expectation(description: "native diagram requested")
                rendered.assertForOverFulfill = false
                let view = ScrollView {
                    XgentMarkdown(text: "## Result\n\n```mermaid\n\(fixture.source)\n```", renderDiagram: { source, requestedDark in
                        rendered.fulfill()
                        XCTAssertEqual(requestedDark, dark)
                        let value: [String: Any] = ["source": source, "dark": requestedDark, "svg": fixture.svg!]
                        return String(data: try! JSONSerialization.data(withJSONObject: value), encoding: .utf8)
                    }).padding(16)
                }
                .frame(width: width, height: 620)
                .environment(\.accessibilityEnabled, true)
                .environment(\.colorScheme, dark ? .dark : .light)
                .preferredColorScheme(dark ? .dark : .light)
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: dark ? .dark : .light))
                .background { XgentThemeBackground() }
                #if os(iOS)
                let host = UIHostingController(rootView: view)
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 620))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 620))
                let native = host.view!
                #else
                let host = NSHostingView(rootView: view)
                host.frame = CGRect(x: 0, y: 0, width: width, height: 620)
                let window = NSWindow(contentRect: host.frame, styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                defer { window.close() }
                host.layoutSubtreeIfNeeded()
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 620))
                let native = host
                #endif
                await fulfillment(of: [rendered], timeout: 3)
                var ready = false
                let deadline = ContinuousClock.now + .seconds(3)
                repeat {
                    try await Task.sleep(for: .milliseconds(60))
                    #if os(iOS)
                    let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: native).flattenToElements()
                    ready = elements.contains { $0.identifier == "xgent-diagram-fullscreen" && !$0.traits.contains(.notEnabled) }
                    #else
                    ready = nativeMacAccessibilityTree(native).contains {
                        $0.accessibilityIdentifier() == "xgent-diagram-fullscreen" && $0.isAccessibilityEnabled()
                    }
                    #endif
                } while !ready && ContinuousClock.now < deadline
                XCTAssertTrue(ready, "The actual native SVG must finish rendering before appearance evidence is captured")
                let snapshot = await withCheckedContinuation { continuation in
                    strategy.snapshot(native).run { continuation.resume(returning: $0) }
                }
                let attachment = XCTAttachment(image: snapshot)
                attachment.name = "native-mermaid-\(Int(width))-\(dark ? "dark" : "light")"
                attachment.lifetime = .keepAlways; add(attachment)
                #if os(macOS)
                let copy = try XCTUnwrap(nativeMacAccessibilityTree(native).first { $0.accessibilityIdentifier() == "xgent-diagram-copy" })
                XCTAssertTrue(copy.accessibilityPerformPress())
                XCTAssertEqual(NSPasteboard.general.string(forType: .string), fixture.source + "\n")
                let fullscreen = try XCTUnwrap(nativeMacAccessibilityTree(native).first { $0.accessibilityIdentifier() == "xgent-diagram-fullscreen" })
                XCTAssertTrue(fullscreen.accessibilityPerformPress())
                let sheetDeadline = ContinuousClock.now + .seconds(3)
                while window.sheets.isEmpty && ContinuousClock.now < sheetDeadline { try await Task.sleep(for: .milliseconds(60)) }
                let sheet = try XCTUnwrap(window.sheets.first)
                let close = try XCTUnwrap(nativeMacAccessibilityTree(sheet).first { $0.accessibilityLabel() == XgentDiagramLabels.fallback.close })
                XCTAssertTrue(close.accessibilityPerformPress())
                #endif
            }
        }
    }

    private func document(revision: Int = 1, diagramAction: String = "render", removed: Bool = false) throws -> XgentDocument {
        let value: [String: Any] = ["version": 1, "surface": "chat", "revision": revision, "mode": "root", "appearance": "light",
            "title": "Chat", "removed": removed, "nodes": [["id": "answer", "kind": "Markdown", "action": "highlight", "diagramAction": diagramAction]]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: value))
        try document.validate(); return document
    }
}
