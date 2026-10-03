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
#else
import AppKit
#endif
@testable import XgentNativeUI

final class MarkdownMathTests: XCTestCase {
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
