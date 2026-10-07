import Foundation
import SwiftUI
import UniformTypeIdentifiers
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class ComposerClipboardTests: XCTestCase {
    private let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=")!

    func testClipboardPreservesImageEncodingAndKeepsOrdinaryTextOutOfAttachments() async throws {
        let payload = try await XgentClipboardAttachment.bytes(png, name: "Clipboard.png", type: .png).payload()
        XCTAssertEqual(payload["mimeType"], "image/png")
        XCTAssertEqual(payload["contentBase64"], png.base64EncodedString())
        XCTAssertTrue(XgentClipboardAttachment.providers([NSItemProvider(object: "plain text" as NSString)]).isEmpty)
        XCTAssertTrue(XgentClipboardAttachment.providers([NSItemProvider(object: URL(string: "https://example.com")! as NSURL)]).isEmpty)
    }

    func testSynchronousProviderCompletionDoesNotCancelSuccessfulProgress() async throws {
        let progress = Progress(totalUnitCount: 1)
        let result: String = try await XgentClipboardLoad.load { complete in
            complete(.success("ready"))
            return progress
        }
        XCTAssertEqual(result, "ready")
        XCTAssertFalse(progress.isCancelled)
    }

    @MainActor func testCancelledProviderResumesOnceAndIgnoresLateCompletion() async throws {
        let progress = Progress(totalUnitCount: 1)
        var completion: (@Sendable (Result<String, Error>) -> Void)?
        let task = Task { try await XgentClipboardLoad<String>.load { callback in
            completion = callback
            return progress
        } }
        let deadline = ContinuousClock.now + .seconds(3)
        while completion == nil, ContinuousClock.now < deadline { await Task.yield() }
        let complete = try XCTUnwrap(completion)
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled clipboard loading must stop") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertTrue(progress.isCancelled)
        complete(.success("late"))
        complete(.failure(CancellationError()))
    }

    @MainActor func testRealComposerImagePasteUsesAttachmentActionAndPreservesDraft() async throws {
        let source = #"{"version":1,"surface":"chat","revision":1,"mode":"root","title":"Chat","appearance":"light","formFactor":"mobile","nodes":[{"id":"draft","kind":"ComposerInput","value":"keep this draft","action":"draft","editAction":"references","selectionAction":"selection","children":[{"id":"draft-attachment-target","kind":"Text","text":"attach"}]},{"id":"attach","kind":"FilePicker","action":"import","options":[{"value":"files","label":"Files"}]}]}"#
        let document = try JSONDecoder().decode(XgentDocument.self, from: Data(source.utf8))
        let model = XgentPresentationModel(); model.update(document)
        var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
        let content = XgentComposerInput(node: document.nodes[0], document: document, model: model)
            .frame(width: 240, height: 120)
        #if os(iOS)
        let host = UIHostingController(rootView: content)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 240, height: 120))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
        host.view.layoutIfNeeded()
        func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap { descendants($0) } }
        try await Task.sleep(for: .milliseconds(160))
        let field = try XCTUnwrap(descendants(host.view).compactMap { $0 as? XgentComposerNativeTextView }.first)
        UIPasteboard.general.setData(png, forPasteboardType: UTType.png.identifier)
        #else
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 240, height: 120),
            styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        host.layoutSubtreeIfNeeded()
        func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap { descendants($0) } }
        try await Task.sleep(for: .milliseconds(160))
        let field = try XCTUnwrap(descendants(host).compactMap { $0 as? XgentComposerNativeTextView }.first)
        NSPasteboard.general.clearContents(); NSPasteboard.general.setData(png, forType: .png)
        #endif
        field.paste(nil)
        let deadline = ContinuousClock.now + .seconds(3)
        while !actions.contains(where: { $0.action == "import" }), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        let action = try XCTUnwrap(actions.first { $0.action == "import" })
        let files = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(action.value.text.utf8)) as? [[String: String]])
        XCTAssertEqual(files.first?["mimeType"], "image/png")
        XCTAssertEqual(files.first?["contentBase64"], png.base64EncodedString())
        #if os(iOS)
        XCTAssertEqual(field.text, "keep this draft")
        #else
        XCTAssertEqual(field.string, "keep this draft")
        #endif
        XCTAssertFalse(actions.contains { $0.action == "draft" || $0.action == "references" })
    }
}
