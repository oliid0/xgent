import WebKit
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class HTMLPreviewTests: XCTestCase {
    func testPreviewDecodesActualUTF8AndRejectsBrokenPayloads() {
        let html = "<h1>任务结果</h1>"
        XCTAssertEqual(XgentHTMLPreviewContent.decode(source: html, encoded: ""), html)
        XCTAssertEqual(XgentHTMLPreviewContent.decode(source: "", encoded: Data(html.utf8).base64EncodedString()), html)
        XCTAssertNil(XgentHTMLPreviewContent.decode(source: "", encoded: "not base64!"))
        XCTAssertNil(XgentHTMLPreviewContent.decode(source: "", encoded: Data([0xff]).base64EncodedString()))
    }

    func testPreviewNavigationDoesNotOpenApplicationCommandsOrLocalFiles() {
        for value in ["https://example.com/report", "http://localhost:8080", "about:blank"] {
            XCTAssertTrue(XgentHTMLPreviewContent.allows(URL(string: value)))
        }
        for value in ["file:///etc/passwd", "tauri://localhost", "xgent://command", "javascript:alert(1)"] {
            XCTAssertFalse(XgentHTMLPreviewContent.allows(URL(string: value)))
        }
    }

    @MainActor
    func testRealWebKitExecutesInteractiveArtifactWithoutApplicationBridgeAndCapturesBothWidths() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        #else
        let widths: [CGFloat] = [640, 1040]
        #endif
        for width in widths {
            let loaded = expectation(description: "Artifact loaded at \(width)")
            loaded.assertForOverFulfill = false
            var loadError: String?
            let coordinator = XgentHTMLPreviewCoordinator { loading, error in
                if !loading { loadError = error; loaded.fulfill() }
            }
            let view = coordinator.makeView()
            view.frame = CGRect(x: 0, y: 0, width: width, height: 480)
            #if os(iOS)
            let controller = UIViewController()
            let window = UIWindow(frame: view.frame)
            window.rootViewController = controller
            controller.view.addSubview(view)
            window.makeKeyAndVisible()
            defer { window.isHidden = true; window.rootViewController = nil }
            #else
            let window = NSWindow(contentRect: view.frame, styleMask: [.titled], backing: .buffered, defer: false)
            window.contentView = view
            window.orderFront(nil)
            defer { window.orderOut(nil); window.contentView = nil }
            #endif
            defer { coordinator.retire(view) }
            let html = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font:18px system-ui;background:#fafafa;color:#222;padding:24px}button{font:inherit;padding:12px}</style>
            </head><body><h1>Workspace report</h1><p id="result">Ready</p>
            <button id="run" onclick="document.getElementById('result').textContent='Completed 你好'">Run calculation</button>
            <script>window.artifactLoaded = true;</script></body></html>
            """
            coordinator.update(view, source: html, attempt: 0)
            // On the hosted simulator the first WebContent/AX process took
            // over 50 seconds in CI #250; later previews loaded normally.
            // Wait for actual navigation completion before inspecting scripts.
            await fulfillment(of: [loaded], timeout: 90)
            XCTAssertNil(loadError)
            XCTAssertFalse(view.configuration.websiteDataStore.isPersistent)
            let bridge = try await view.evaluateJavaScript("typeof window.__TAURI_INTERNALS__") as? String
            let artifactLoaded = try await view.evaluateJavaScript("window.artifactLoaded") as? Bool
            XCTAssertEqual(bridge, "undefined")
            XCTAssertEqual(artifactLoaded, true)
            _ = try await view.evaluateJavaScript("document.getElementById('run').click()")
            let result = try await view.evaluateJavaScript("document.getElementById('result').textContent") as? String
            XCTAssertEqual(result, "Completed 你好")
            let image = try await view.takeSnapshot(configuration: nil)
            XCTAssertGreaterThan(image.size.width, 0)
            let attachment = XCTAttachment(image: image)
            attachment.name = "html-artifact-\(Int(width))"
            attachment.lifetime = .keepAlways
            add(attachment)
            coordinator.retire(view)
            XCTAssertNil(view.navigationDelegate)
        }
    }
}
