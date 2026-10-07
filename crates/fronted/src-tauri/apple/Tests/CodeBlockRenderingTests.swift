import Foundation
import MarkdownUI
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class CodeBlockRenderingTests: XCTestCase {
    func testCollapseBoundaryAndVerbatimUTF16Source() {
        for count in [11, 12, 13] {
            for separator in ["\n", "\r\n"] {
                let source = Array(repeating: "\t🧭 <script>", count: count).joined(separator: separator) + separator
                let metrics = XgentCodeBlockMetrics(source: source)
                XCTAssertEqual(metrics.lineCount, count)
                XCTAssertEqual(metrics.canCollapse(.markdown, hasHeader: true), count >= 12)
                XCTAssertFalse(metrics.canCollapse(.markdown, hasHeader: false))
                XCTAssertFalse(metrics.canCollapse(.plain, hasHeader: true))
                XCTAssertEqual((metrics.displayText as NSString).length, (source as NSString).length - 1)
                XCTAssertEqual(metrics.source, source)
            }
        }
        XCTAssertEqual(XgentCodeBlockMetrics(source: "").lineCount, 1)
        XCTAssertEqual(XgentCodeBlockMetrics(source: "line\n\n").lineCount, 2)
    }

    @MainActor func testParsedMarkdownStateSurvivesGrowthAndKeepsIdenticalFencesIndependent() throws {
        let store = XgentMarkdownCodeStore()
        let start = "```swift title=Example.swift\nlet emoji = \"🧭 & <script>\"\n```"
        _ = store.prepare(start)
        let first = try XCTUnwrap(store.entry(content: "let emoji = \"🧭 & <script>\"", language: "swift title=Example.swift"))
        XCTAssertEqual(first.code.source, "let emoji = \"🧭 & <script>\"\n")
        first.state.collapsed = true; first.state.offset = CGPoint(x: 80, y: 160); first.state.contentHeight = 800
        _ = store.prepare(start.replacingOccurrences(of: "\n```", with: "\nlet next = 42\n```"))
        let grown = try XCTUnwrap(store.entry(content: "let emoji = \"🧭 & <script>\"\nlet next = 42", language: "swift"))
        XCTAssertTrue(first.state === grown.state)
        XCTAssertTrue(grown.state.collapsed); XCTAssertEqual(grown.state.offset, CGPoint(x: 80, y: 160))
        XCTAssertEqual(grown.state.contentHeight, 800)
        _ = store.prepare("```swift\nidentical\n```\n\n```swift\nidentical\n```")
        XCTAssertNil(store.entry(content: "identical", language: "swift"), "Ambiguous fences must not share one interaction state")
        _ = store.prepare("```swift\nreplacement\n```")
        let replacement = try XCTUnwrap(store.entry(content: "replacement", language: "swift"))
        XCTAssertFalse(first.state === replacement.state); XCTAssertFalse(replacement.state.collapsed)
        XCTAssertEqual(XgentMarkdownCodeEntry.parse(MarkdownContent("```\n``` ").renderHTML()).first?.source, "")
    }

    @MainActor func testMarkdownCacheDistinguishesCanonicallyEquivalentCodeUnits() throws {
        let store = XgentMarkdownCodeStore()
        let composed = "let name = \"\u{e9}\"", decomposed = "let name = \"e\u{301}\""
        XCTAssertEqual(composed, decomposed)
        _ = store.prepare("```swift\n" + composed + "\n```")
        let original = try XCTUnwrap(store.entry(content: composed, language: "swift"))
        original.state.collapsed = true
        XCTAssertNil(store.entry(content: decomposed, language: "swift"))
        _ = store.prepare("```swift\n" + decomposed + "\n```")
        let replacement = try XCTUnwrap(store.entry(content: decomposed, language: "swift"))
        XCTAssertTrue(replacement.code.source.utf16.elementsEqual((decomposed + "\n").utf16))
        XCTAssertFalse(original.state === replacement.state)
        XCTAssertFalse(replacement.state.collapsed)
        XCTAssertNil(store.entry(content: composed, language: "swift"))
    }

    func testBoundsRejectInvalidConfigurationAndAdaptToWindowSize() {
        XCTAssertEqual(XgentCodeBlockMetrics.heightLimit(.markdown, viewportHeight: 1000), 576)
        XCTAssertEqual(XgentCodeBlockMetrics.heightLimit(.markdown, viewportHeight: 400), 240)
        XCTAssertNil(XgentCodeBlockMetrics.heightLimit(.plain, viewportHeight: 400))
        for raw in ["{\"maxHeight\":0}", "{\"maxHeight\":-1}", "{\"viewportFraction\":2}", "{\"collapseLines\":0}", "{\"container\":\"unsupported\"}", "not-json"] {
            XCTAssertEqual(XgentCodeBlockConfiguration.decode(raw, fallback: .markdown), .markdown)
        }
        let geometry = XgentCodeBlockScrollGeometry(offset: .zero, contentSize: CGSize(width: 1000, height: 2000), viewportSize: CGSize(width: 320, height: 240))
        XCTAssertEqual(geometry.bounded(CGPoint(x: -10, y: -20)), .zero)
        XCTAssertEqual(geometry.bounded(CGPoint(x: 10000, y: 10000)), CGPoint(x: 680, y: 1760))
    }

    @MainActor func testNativeCodeBodyHugsShortContentAndBoundsLongOutput() async throws {
        for appearance in [XgentDocument.Appearance.light, .dark] {
            var heights: [CGFloat] = []
            for source in ["short", String(repeating: "🧭 output & value\n", count: 200)] {
                let view = XgentCodeBlock(text: source, language: "plaintext", configuration: .init(maxHeight: 224))
                    .frame(width: 320)
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: appearance))
                #if os(iOS)
                let hosting = UIHostingController(rootView: view)
                hosting.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 720))
                window.rootViewController = hosting; window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                hosting.view.layoutIfNeeded()
                try await Task.sleep(nanoseconds: 250_000_000)
                let height = hosting.sizeThatFits(in: CGSize(width: 320, height: 720)).height
                #else
                let hosting = NSHostingView(rootView: view)
                hosting.frame = CGRect(x: 0, y: 0, width: 320, height: 720)
                hosting.layoutSubtreeIfNeeded()
                try await Task.sleep(nanoseconds: 250_000_000)
                let height = hosting.fittingSize.height
                #endif
                heights.append(height)
                XCTAssertGreaterThan(height, 20)
                XCTAssertLessThanOrEqual(height, 225)
            }
            XCTAssertGreaterThan(heights[1], heights[0] + 100)
        }
    }

    @MainActor func testClipboardCopiesTheCompleteSourceIncludingBlankLinesAndUnicode() {
        let source = "\t  🧭 <script> & value\r\n\r\n" + String(repeating: "line\n", count: 300)
        #if os(iOS)
        let clipboard = UIPasteboard.general, previous = clipboard.items
        defer { clipboard.items = previous }
        XCTAssertTrue(XgentCodeClipboard.copy(source))
        XCTAssertEqual(clipboard.string, source)
        #else
        let clipboard = NSPasteboard.general
        let previous = (clipboard.pasteboardItems ?? []).map { item in
            let copy = NSPasteboardItem()
            for type in item.types {
                if let data = item.data(forType: type) { copy.setData(data, forType: type) }
            }
            return copy
        }
        defer { clipboard.clearContents(); if !previous.isEmpty { clipboard.writeObjects(previous) } }
        XCTAssertTrue(XgentCodeClipboard.copy(source))
        XCTAssertEqual(clipboard.string(forType: .string), source)
        #endif
    }
}
