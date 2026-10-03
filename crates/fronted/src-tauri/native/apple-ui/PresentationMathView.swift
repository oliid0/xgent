import MarkdownUI
import SwaTex
import SwaTexRender
import SwiftUI

struct XgentMathView: View {
    let formula: XgentMathFormula
    let fontSize: CGFloat
    let foreground: SwiftUI.Color

    var body: some View {
        if XgentMathFonts.available {
            ScrollView(.horizontal) {
                MathView(formula.source).font(size: fontSize)
                    .inlineStyle(!formula.display).mathColor(foreground)
                    .accessibilityLabel(formula.source)
                    .padding(.vertical, 4)
            }
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(formula.source).foregroundStyle(foreground)
                .textSelection(.enabled).accessibilityLabel(formula.source)
        }
    }
}

struct XgentMathImageProvider: ImageProvider, InlineImageProvider {
    let fontSize: CGFloat
    let foreground: SwiftUI.Color
    let rgba: SwaTex.Color

    @ViewBuilder func makeImage(url: URL?) -> some View {
        if let url, let formula = XgentMathFormula(url: url) {
            XgentMathView(formula: formula, fontSize: fontSize, foreground: foreground)
        }
    }

    func image(with url: URL, label: String) async throws -> Image {
        guard let formula = XgentMathFormula(url: url), XgentMathFonts.available,
              formula.source.utf8.count <= 16_384 else { throw CocoaError(.featureUnsupported) }
        let list = try SwaTexEngine.displayList(for: formula.source, style: formula.display ? .display : .text, color: rgba)
        let options = RenderOptions(fontSize: fontSize, padding: 0)
        let metrics = DisplayListRenderer.metrics(for: list, options: options)
        guard !list.truncated, metrics.width.isFinite, metrics.height.isFinite,
              metrics.width > 0, metrics.height > 0, metrics.width <= 2048, metrics.height <= 2048,
              let image = SwaTexRender.ImageRenderer.image(for: list, options: options, displayScale: 2) else {
            throw CocoaError(.featureUnsupported)
        }
        return Image(image, scale: 2, orientation: .up, label: Text(formula.source))
    }
}
