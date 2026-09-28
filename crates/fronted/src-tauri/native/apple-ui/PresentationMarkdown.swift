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
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var bodySize: CGFloat = 15

    private var palette: XgentPalette { theme.palette(for: colorScheme) }

    var body: some View {
        Markdown(text)
            .markdownTheme(.gitHub)
            .markdownTextStyle {
                FontSize(bodySize * CGFloat(theme.fontScale * theme.typography.body / 15))
                ForegroundColor(Color(xgentHex: secondary ? palette.secondaryText : palette.text))
                BackgroundColor(nil)
            }
            .markdownTextStyle(\.link) { ForegroundColor(Color(xgentHex: palette.accentText)) }
            .markdownBlockStyle(\.image) { configuration in
                // Match the web transcript's alt-text policy; attachments have
                // their own explicit native media preview and loading lifecycle.
                Text(configuration.content.renderPlainText())
            }
            .markdownImageProvider(XgentMarkdownImageFallback())
            .markdownInlineImageProvider(XgentMarkdownImageFallback())
            .markdownCodeSyntaxHighlighter(XgentSwiftHighlighter(dark: colorScheme == .dark))
            .markdownBlockStyle(\.codeBlock) { configuration in
                XgentCodeBlock(text: configuration.content, language: configuration.language)
                    .markdownMargin(top: 0, bottom: 12)
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
    static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

private struct XgentMarkdownImageFallback: ImageProvider, InlineImageProvider {
    func makeImage(url: URL?) -> some View { EmptyView() }
    func image(with url: URL, label: String) async throws -> Image {
        throw CocoaError(.featureUnsupported)
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
