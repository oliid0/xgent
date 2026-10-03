import Foundation
import MarkdownUI
import Splash
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// Shared by the handwritten iOS surface and the macOS renderer. MarkdownUI's
// cmark parser preserves lists, tables and fenced blocks (as in yy's renderer).
struct XgentMarkdown: View {
    let text: String
    var secondary = false
    var codeConfiguration = XgentCodeBlockConfiguration.markdown
    var highlightCode: ((String, String) async -> String?)? = nil
    var renderDiagram: ((String, Bool) async -> String?)? = nil
    @StateObject private var codeStore = XgentMarkdownCodeStore()
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var bodySize: CGFloat = 15

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var mathProvider: XgentMathImageProvider {
        let color = Color(xgentHex: secondary ? palette.secondaryText : palette.text)
        let resolved = color.resolve(in: EnvironmentValues())
        return XgentMathImageProvider(fontSize: bodySize * CGFloat(theme.fontScale * theme.typography.body / 15),
            foreground: color, rgba: .init(r: resolved.red, g: resolved.green, b: resolved.blue, a: resolved.opacity))
    }

    var body: some View {
        Markdown(codeStore.prepare(XgentMarkdownMath.prepare(text,
            renderKey: "\(mathProvider.fontSize)-\(secondary ? palette.secondaryText : palette.text)")))
            .markdownTheme(MarkdownUI.Theme.gitHub.text {
                if let name = XgentFonts.name(for: theme.fontFamily) { FontFamily(.custom(name)) }
                FontSize(bodySize * CGFloat(theme.fontScale * theme.typography.body / 15))
                ForegroundColor(Color(xgentHex: secondary ? palette.secondaryText : palette.text))
                BackgroundColor(nil)
            })
            .markdownTextStyle(\.link) { ForegroundColor(Color(xgentHex: palette.accentText)) }
            .markdownBlockStyle(\.image) { configuration in
                if let formula = XgentMathFormula.block(in: configuration.content.renderMarkdown()) {
                    XgentMathView(formula: formula, fontSize: mathProvider.fontSize, foreground: mathProvider.foreground)
                        .markdownMargin(top: 4, bottom: 12)
                } else {
                    // Attachments have their own native media loading lifecycle.
                    Text(configuration.content.renderPlainText())
                }
            }
            .markdownImageProvider(mathProvider)
            .markdownInlineImageProvider(mathProvider)
            .markdownBlockStyle(\.codeBlock) { configuration in
                let entry = codeStore.entry(content: configuration.content, language: configuration.language)
                if ["mermaid", "mmd"].contains(XgentMarkdownCodeEntry.languageName(configuration.language)?.lowercased() ?? "") {
                    XgentMermaidDiagram(source: entry?.code.source ?? configuration.content, configuration: codeConfiguration,
                                        retainedState: entry?.diagram, renderDiagram: renderDiagram)
                        .markdownMargin(top: 0, bottom: 12)
                } else {
                    XgentCodeBlock(text: entry?.code.source ?? (configuration.content.isEmpty ? "" : configuration.content + "\n"),
                               language: XgentMarkdownCodeEntry.languageName(configuration.language) ?? "markdown",
                               configuration: codeConfiguration, retainedState: entry?.state, highlightCode: highlightCode)
                    .markdownMargin(top: 0, bottom: 12)
                }
            }
            .markdownBlockStyle(\.table) { configuration in
                ScrollView(.horizontal) {
                    configuration.label
                        .markdownTableBorderStyle(.init(color: Color(xgentHex: palette.border)))
                        .markdownTableBackgroundStyle(.alternatingRows(
                            Color(xgentHex: palette.surface), Color(xgentHex: palette.muted)
                        ))
                }
                .markdownMargin(top: 0, bottom: 12)
            }
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

@MainActor
enum XgentCodeClipboard {
    @discardableResult static func copy(_ text: String) -> Bool {
        #if os(iOS)
        UIPasteboard.general.string = text
        return true
        #else
        NSPasteboard.general.clearContents()
        return NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

struct XgentSwiftHighlighter: CodeSyntaxHighlighter {
    private let highlighter: SyntaxHighlighter<AttributedStringOutputFormat>

    init(dark: Bool) {
        let theme: Splash.Theme = dark
            ? .wwdc17(withFont: .init(size: 13))
            : .sunset(withFont: .init(size: 13))
        highlighter = SyntaxHighlighter(format: AttributedStringOutputFormat(theme: theme))
    }

    func attributedCode(_ content: String, language: String?) -> NSAttributedString {
        // Splash is a Swift tokenizer. Other languages retain their original text.
        guard language?.lowercased() == "swift" else { return NSAttributedString(string: content) }
        // Splash 0.16 duplicates the first whitespace token. Keep the exact
        // source prefix outside its tokenizer so indentation/copy stay intact.
        let prefix = String(content.prefix(while: { $0.isWhitespace }))
        let code = String(content.dropFirst(prefix.count))
        let highlighted = highlighter.highlight(code)
        guard highlighted.string == code else { return NSAttributedString(string: content) }
        let result = NSMutableAttributedString(string: prefix)
        result.append(highlighted)
        // Let the SwiftUI font scale with Dynamic Type rather than keeping
        // Splash's fixed platform font on every token.
        result.removeAttribute(.font, range: NSRange(location: 0, length: result.length))
        return result
    }

    func highlightCode(_ content: String, language: String?) -> Text {
        let value = attributedCode(content, language: language)
        #if os(iOS)
        let attributed = try? AttributedString(value, including: \.uiKit)
        #else
        let attributed = try? AttributedString(value, including: \.appKit)
        #endif
        return Text(attributed ?? AttributedString(content))
    }
}
