import CoreText
import MarkdownUI
import SnapshotTesting
import SwaTex
import SwaTexRender
import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
private typealias MathSnapshotImage = UIImage
#else
import AppKit
private typealias MathSnapshotImage = NSImage
#endif
@testable import XgentNativeUI

final class MarkdownMathTests: XCTestCase {
    @MainActor func testMountedInlineFormulaAddsVisiblePixelsAfterReadinessUpdates() async throws {
        #if os(macOS)
        _ = NSApplication.shared
        #endif
        for width: CGFloat in [320, 768] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                func content(_ text: String) -> AnyView {
                    AnyView(ScrollView { XgentMarkdown(text: text).padding(16) }
                        .frame(width: width, height: 240).dynamicTypeSize(size)
                        .background(.white)
                        .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light)))
                }
                #if os(iOS)
                let host = UIHostingController(rootView: content("Answer ."))
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 240))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                let native = host.view!
                #else
                let host = NSHostingView(rootView: content("Answer ."))
                host.frame = CGRect(x: 0, y: 0, width: width, height: 240)
                let window = NSWindow(contentRect: host.frame, styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                defer { window.close() }
                host.layoutSubtreeIfNeeded()
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 240))
                let native = host
                #endif
                func capture() async -> MathSnapshotImage {
                    #if os(iOS)
                    // SnapshotTesting's UIView strategy reparents the hosted
                    // view into a temporary window. Repeated probes therefore
                    // cancel the very image task this mounted-update test checks.
                    // Keep the same layer renderer, with the real host mounted.
                    XCTAssertTrue(native.window === window)
                    let renderer = UIGraphicsImageRenderer(bounds: native.bounds,
                        format: UIGraphicsImageRendererFormat(for: native.traitCollection))
                    return renderer.image { context in native.layer.render(in: context.cgContext) }
                    #else
                    return await withCheckedContinuation { continuation in
                        strategy.snapshot(native).run { continuation.resume(returning: $0) }
                    }
                    #endif
                }
                try await Task.sleep(for: .milliseconds(100))
                let proseSnapshot = await capture()
                let proseAttachment = XCTAttachment(image: proseSnapshot)
                proseAttachment.name = "native-inline-math-prose-\(Int(width))-\(size)"
                proseAttachment.lifetime = .keepAlways; add(proseAttachment)
                let proseInk = try mathInkPixels(proseSnapshot)
                XCTAssertGreaterThan(proseInk, 50, "The comparison must contain actual rendered prose")
                host.rootView = content("Answer $$x^2 + y^2$$.")
                var screenshot = await capture()
                var ink = try mathInkPixels(screenshot)
                let deadline = ContinuousClock.now + .seconds(3)
                while ink <= proseInk * 6 / 5 && ContinuousClock.now < deadline {
                    try await Task.sleep(for: .milliseconds(60))
                    screenshot = await capture()
                    ink = try mathInkPixels(screenshot)
                }
                let attachment = XCTAttachment(image: screenshot)
                attachment.name = "native-inline-math-pixels-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways; add(attachment)
                XCTAssertGreaterThan(ink, proseInk * 6 / 5,
                    "The mounted formula must add visible ink at \(width)/\(size); a restored accessibility label alone is insufficient")
                #if os(iOS)
                try attachCompositedNativeScreenshot(of: native,
                    name: "native-inline-math-pixels-\(Int(width))-\(size)")
                #endif
            }
        }
    }

    @MainActor func testAccessibleParagraphKeepsProseAndOnlyUsesActuallyRasterizedFormulas() async throws {
        let formula = XgentMathFormula(source: #"x^2 + \frac{a_b}{2}"#, display: false)
        let content = XgentMathAccessibilityText(markdown: "**Answer** \(formula.markdown). [Details](https://example.com)")
        XCTAssertEqual(content.urls, [formula.url])
        XCTAssertTrue(content.label.contains(formula.source))
        XCTAssertTrue(content.label.contains("Answer"))
        XCTAssertTrue(content.label.contains("Details"))
        XCTAssertFalse(content.label.contains("xgent-math"))
        let store = XgentMathAccessibilityStore()
        XCTAssertTrue(store.rendered.isEmpty)
        let provider = XgentMathImageProvider(fontSize: 15, foreground: .black, rgba: .black,
            didRender: { url in await store.register(url) })
        _ = try await provider.image(with: formula.url, label: "formula")
        XCTAssertEqual(store.rendered, [formula.url])
    }

    func testCurrencyCodeAndLinkTargetsKeepTheirExactSource() {
        let unchanged = #"Price $20, $x$, `$$x^2$$`, [link](https://example.com/$$path$$), \$$escaped$$"#
        XCTAssertEqual(XgentMarkdownMath.prepare(unchanged), unchanged)
        for code in ["```swift\nlet value = \"$$x$$\"\n```", "~~~text\n$$\nx^2\n$$\n~~~", "    $$indented$$"] {
            XCTAssertEqual(XgentMarkdownMath.prepare(code), code)
        }
        XCTAssertEqual(XgentMarkdownMath.prepare("An incomplete $$x^2"), "An incomplete $$x^2")
        XCTAssertEqual(XgentMarkdownMath.prepare("$$x$$$"), "$$x$$$")
    }

    func testInlineAndDisplayFormulasRetainUnicodeAndTheirMarkdownContainers() throws {
        let inline = XgentMathFormula(source: #"\frac{a}{b}"#, display: false)
        XCTAssertEqual(XgentMarkdownMath.prepare(#"Answer $$\frac{a}{b}$$."#), "Answer \(inline.markdown).")
        XCTAssertEqual(XgentMathFormula(url: inline.url), inline)
        let unicode = XgentMathFormula(source: #"\text{中文🙂} + x_2"#, display: true)
        XCTAssertEqual(XgentMathFormula(url: unicode.url), unicode)
        XCTAssertEqual(XgentMarkdownMath.prepare("$$\n\(unicode.source)\n$$"), unicode.markdown)
        let block = XgentMathFormula(source: #"x^2 + y^2"#, display: true)
        let quote = "> $$\n> x^2 + y^2\n> $$"
        XCTAssertEqual(XgentMarkdownMath.prepare(quote), "> \(block.markdown)")
        let parsed = MarkdownContent(XgentMarkdownMath.prepare(quote))
        XCTAssertTrue(parsed.renderHTML().contains("<blockquote>"))
        XCTAssertTrue(parsed.renderHTML().contains("xgent-math://display/"))
        XCTAssertEqual(XgentMathFormula.block(in: block.markdown), block)
        XCTAssertNil(XgentMathFormula(url: try XCTUnwrap(URL(string: "https://example.com/image.png"))))
        let light = XgentMarkdownMath.prepare("Text $$x_1$$", renderKey: "15-#111111")
        let dark = XgentMarkdownMath.prepare("Text $$x_1$$", renderKey: "28-#eeeeee")
        XCTAssertNotEqual(light, dark, "Inline image tasks must reload when color or Dynamic Type changes")
        XCTAssertEqual(XgentMathFormula.block(in: light)?.source, "x_1")
        let mixed = XgentMarkdownMath.prepare("![diagram](https://example.com/a.png) and $$x_1$$")
        XCTAssertTrue(mixed.hasPrefix("diagram and ![formula](xgent-math://inline/"))
        XCTAssertFalse(mixed.contains("https://"), "An alt-text image must not fail the paragraph's math image task")
    }

    @MainActor func testNativeFormulaFontsRasterizationAndChatWidths() async throws {
        #if os(macOS)
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        #endif
        XCTAssertTrue(XgentMathFonts.available, "SDK rendering must use the packaged KaTeX font bundle")
        let font = KaTeXFontProvider.shared.font(for: .mainRegular, size: 20)
        XCTAssertTrue((CTFontCopyPostScriptName(font) as String).hasPrefix("KaTeX"), "System-font fallback does not verify math parity")
        let formula = XgentMathFormula(source: #"\frac{-b \pm \sqrt{b^2-4ac}}{2a}"#, display: true)
        let provider = XgentMathImageProvider(fontSize: 20, foreground: .black, rgba: .black)
        _ = try await provider.image(with: formula.url, label: formula.source)
        let image = try XCTUnwrap(SwaTexRender.ImageRenderer.image(latex: formula.source,
            options: RenderOptions(fontSize: 20, padding: 0)))
        XCTAssertGreaterThan(image.width, 80)
        XCTAssertGreaterThan(image.height, 40)
        let text = "Answer $$x^2 + y^2$$.\n\n$$\n\(formula.source)\n$$\n\n| Value | Formula |\n| --- | --- |\n| roots | $$x_1$$ |\n\n```swift\nlet formula = \"$$x$$\"\n```"
        for width: CGFloat in [320, 768] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let view = ScrollView { XgentMarkdown(text: text).padding(16) }
                    .frame(width: width, height: 720).dynamicTypeSize(size)
                    .environment(\.accessibilityEnabled, true)
                    .background { XgentThemeBackground() }
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                #if os(iOS)
                let host = UIHostingController(rootView: view)
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded()
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                let native = host.view!
                #else
                let host = NSHostingView(rootView: view)
                host.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                let window = NSWindow(contentRect: host.frame, styleMask: [.titled], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false; window.contentView = host; window.makeKeyAndOrderFront(nil)
                defer { window.close() }
                host.layoutSubtreeIfNeeded()
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                let native = host
                #endif
                var labels: [String] = []
                let deadline = ContinuousClock.now + .seconds(3)
                repeat {
                    try await Task.sleep(for: .milliseconds(60))
                    #if os(iOS)
                    let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: native)
                    labels = hierarchy.flattenToElements().compactMap(\.label)
                    #else
                    labels = nativeMacAccessibilityTree(native).compactMap { $0.accessibilityText() }
                    #endif
                } while !labels.contains(where: { $0.contains("y^2") }) && ContinuousClock.now < deadline
                try attachNativeAccessibilityEvidence(labels, name: "native-math-labels-\(Int(width))-\(size)")
                XCTAssertTrue(labels.contains(where: { $0.contains("y^2") }), "A ready formula must appear in the real first paragraph, not only in a separate raster test")
                // The provider callback precedes MarkdownUI publishing its
                // image dictionary. Capture the next rendered frame too.
                try await Task.sleep(for: .milliseconds(100))
                let snapshot = await withCheckedContinuation { continuation in
                    strategy.snapshot(native).run { continuation.resume(returning: $0) }
                }
                let attachment = XCTAttachment(image: snapshot)
                attachment.name = "native-math-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways; add(attachment)
            }
        }
    }
}

private func mathInkPixels(_ snapshot: MathSnapshotImage) throws -> Int {
    #if os(iOS)
    let image = try XCTUnwrap(snapshot.cgImage)
    #else
    let image = try XCTUnwrap(snapshot.cgImage(forProposedRect: nil, context: nil, hints: nil))
    #endif
    let context = try XCTUnwrap(CGContext(data: nil, width: image.width, height: image.height,
        bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
    context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(image.width), height: CGFloat(image.height)))
    let pixels = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
    var count = 0
    for offset in stride(from: 0, to: image.width * image.height * 4, by: 4) {
        if pixels[offset] < 100 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100 && pixels[offset + 3] > 200 {
            count += 1
        }
    }
    return count
}
