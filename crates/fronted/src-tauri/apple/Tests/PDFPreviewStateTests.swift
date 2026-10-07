import CoreGraphics
import CoreText
import Foundation
import PDFKit
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class PDFPreviewStateTests: XCTestCase {
    @MainActor func testRepeatedInputPreservesNativePageZoomAndDocumentWhileNewBytesReload() async throws {
        let coordinator = XgentPDFPreview.Coordinator()
        let view = PDFView(frame: CGRect(x: 0, y: 0, width: 600, height: 400))
        #if os(iOS)
        let controller = UIViewController()
        controller.view.addSubview(view)
        let window = UIWindow(frame: view.frame)
        window.rootViewController = controller; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        #else
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view; window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        #endif
        let data = try fixture(pages: 2)
        coordinator.load(data, into: view)
        try await Task.sleep(for: .milliseconds(200))
        let document = try XCTUnwrap(view.document)
        let page = try XCTUnwrap(document.page(at: 1))
        // PDFKit owns the displayed document, including native page rotation.
        // That state must survive an unrelated update of the same input.
        page.rotation = 90
        view.go(to: page)
        view.autoScales = false
        view.scaleFactor = 1.4
        try await Task.sleep(for: .milliseconds(200))
        for _ in 0..<3 { coordinator.load(Data(data), into: view) }
        XCTAssertTrue(view.document === document)
        XCTAssertTrue(view.currentPage === page)
        XCTAssertEqual(page.rotation, 90)
        XCTAssertFalse(view.autoScales)
        XCTAssertEqual(view.scaleFactor, 1.4, accuracy: 0.001)
        let remounted = PDFView(frame: view.frame)
        coordinator.load(Data(data), into: remounted)
        XCTAssertEqual(remounted.document?.pageCount, 2,
            "A retained editor session must load the same bytes into a newly mounted PDFView")
        XCTAssertTrue(coordinator.view === remounted)
        coordinator.load(try fixture(pages: 1), into: view)
        XCTAssertFalse(view.document === document)
        XCTAssertEqual(view.document?.pageCount, 1)
        XCTAssertTrue(view.autoScales)
    }

    @MainActor func testActualTextSelectionProducesPageCoordinatesAndDraftUndoPreservesOriginalAnnotations() throws {
        let coordinator = XgentPDFPreview.Coordinator()
        let view = PDFView(frame: CGRect(x: 0, y: 0, width: 600, height: 800))
        coordinator.load(try fixture(pages: 2), into: view)
        let document = try XCTUnwrap(view.document)
        let page = try XCTUnwrap(document.page(at: 1))
        XCTAssertTrue(page.string?.contains("Original selectable text") == true)
        let original = PDFAnnotation(bounds: CGRect(x: 10, y: 10, width: 25, height: 25), forType: .text, withProperties: nil)
        original.contents = "Existing note"; page.addAnnotation(original)
        // PDFKit also installs the text note's associated Popup annotation.
        // Preserve the complete original set, including that related object.
        let originals = page.annotations
        XCTAssertTrue(originals.contains(where: { $0 === original }))
        let selection = try XCTUnwrap(page.selection(for: CGRect(x: 25, y: 65, width: 250, height: 30)))
        view.currentSelection = selection
        let highlights = coordinator.selectedHighlights(color: "pink")
        XCTAssertFalse(highlights.isEmpty)
        XCTAssertEqual(highlights.first?.pageIndex, 1)
        XCTAssertEqual(highlights.first?.color, "pink")
        let rectangle = try XCTUnwrap(highlights.first?.rects.first)
        XCTAssertEqual(rectangle[0], 30, accuracy: 2)
        XCTAssertGreaterThan(rectangle[2], 50)
        XCTAssertGreaterThan(rectangle[3], 5)
        coordinator.show(highlights, in: view)
        XCTAssertTrue(view.document === document)
        XCTAssertEqual(page.annotations.count, originals.count + highlights.flatMap(\.rects).count)
        let draft = try XCTUnwrap(page.annotations.first(where: { candidate in
            !originals.contains(where: { $0 === candidate })
        }))
        XCTAssertEqual(draft.type, "Highlight")
        XCTAssertEqual(draft.quadrilateralPoints?.count, 4)
        coordinator.show(highlights, in: view)
        XCTAssertTrue(page.annotations.contains(where: { $0 === draft }))
        coordinator.show([], in: view)
        XCTAssertEqual(page.annotations.count, originals.count)
        for annotation in originals {
            XCTAssertTrue(page.annotations.contains(where: { $0 === annotation }))
        }
        view.clearSelection()
        XCTAssertTrue(coordinator.selectedHighlights(color: "yellow").isEmpty)
    }

    private func fixture(pages: Int) throws -> Data {
        let data = NSMutableData()
        let consumer = try XCTUnwrap(CGDataConsumer(data: data as CFMutableData))
        var mediaBox = CGRect(x: 0, y: 0, width: 600, height: 800)
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: &mediaBox, nil))
        for _ in 0..<pages {
            context.beginPDFPage(nil)
            context.fill(CGRect(x: 20, y: 20, width: 100, height: 100))
            let text = NSAttributedString(string: "Original selectable text", attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, 16, nil)
            ])
            context.textMatrix = .identity
            context.textPosition = CGPoint(x: 30, y: 70)
            CTLineDraw(CTLineCreateWithAttributedString(text as CFAttributedString), context)
            context.endPDFPage()
        }
        context.closePDF()
        return data as Data
    }
}
