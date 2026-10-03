import Foundation
import MarkdownUI
import SwiftUI

// Text(Image) loses the image's accessibility label when MarkdownUI joins it
// to surrounding prose. Restore the paragraph text after its real image
// provider has rasterized every formula, without changing link interaction.
@MainActor
final class XgentMathAccessibilityStore: ObservableObject {
    @Published private(set) var rendered: Set<URL> = []

    func register(_ url: URL) {
        if !rendered.contains(url) { rendered.insert(url) }
    }
}

struct XgentMathAccessibilityText {
    let urls: [URL]
    let label: String
    private static let expression = try! NSRegularExpression(pattern: #"!\[formula\]\((xgent-math://[^)]+)\)"#)

    init(markdown: String) {
        guard markdown.contains("xgent-math://") else {
            urls = []; label = ""; return
        }
        let source = markdown as NSString
        let matches = Self.expression.matches(in: markdown, range: NSRange(location: 0, length: source.length))
        var text = markdown
        var urls: [URL] = []
        for match in matches.reversed() {
            guard let url = URL(string: source.substring(with: match.range(at: 1))),
                  let formula = XgentMathFormula(url: url),
                  let range = Range(match.range, in: text) else { continue }
            urls.append(url)
            let escaped = formula.source.reduce(into: "") { result, character in
                if #"\`*_{}[]<>!#|"#.contains(character) { result.append("\\") }
                result.append(character)
            }
            text.replaceSubrange(range, with: escaped)
        }
        self.urls = urls
        label = MarkdownContent(text).renderPlainText()
    }
}

struct XgentMathParagraphAccessibility: ViewModifier {
    @ObservedObject var store: XgentMathAccessibilityStore
    let text: XgentMathAccessibilityText

    func body(content: Content) -> some View {
        // Keep InlineText's identity while its image task is completing. A
        // conditional content branch would discard its loaded images when
        // the provider publishes readiness, then start the image task again.
        content.accessibilityLabel(text.label,
            isEnabled: !text.urls.isEmpty && text.urls.allSatisfy { store.rendered.contains($0) })
    }
}
