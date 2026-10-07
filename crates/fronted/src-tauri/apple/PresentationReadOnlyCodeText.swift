import SwiftUI

private struct XgentReadOnlyCodeRequest: Equatable {
    let source: String
    let language: String
    let theme: String?
    static func == (left: Self, right: Self) -> Bool {
        left.source.utf16.elementsEqual(right.source.utf16) && left.language == right.language && left.theme == right.theme
    }
}

struct XgentReadOnlyCodeText: View {
    let source: String
    let display: String
    let language: String
    let theme: String?
    let foreground: XgentReadOnlySyntax.Style?
    let query: ((String, String) async -> String?)?
    @ObservedObject var state: XgentCodeBlockState
    @Environment(\.colorScheme) private var scheme

    private var request: XgentReadOnlyCodeRequest { .init(source: source, language: language, theme: theme) }

    @ViewBuilder private var text: some View {
        if let syntax = state.syntax, syntax.matches(source: source, language: language, theme: theme) {
            XgentReadOnlySyntaxRenderer(syntax: syntax, scheme: scheme).text(display)
        } else if theme == nil {
            XgentSwiftHighlighter(dark: scheme == .dark).highlightCode(display, language: language)
        } else {
            if let foreground {
                Text(display).foregroundStyle(Color(xgentHex: scheme == .dark ? foreground.dark : foreground.light))
            } else { Text(display) }
        }
    }

    var body: some View {
        text.task(id: request) {
            guard let query, theme != nil else { return }
            if state.syntax?.matches(source: source, language: language, theme: theme) == true { return }
            let reply = await query(source, language)
            guard !Task.isCancelled, let syntax = XgentReadOnlySyntax.decode(reply),
                  syntax.matches(source: source, language: language, theme: theme) else { return }
            state.syntax = syntax
        }
    }
}
