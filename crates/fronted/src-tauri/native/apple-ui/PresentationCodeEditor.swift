import CodeEditorView
import Foundation
import LanguageSupport
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum XgentCodeLanguages {
    private static let swift = LanguageConfiguration.swift()
    private static let python = LanguageConfiguration.python()
    private static let sqlite = LanguageConfiguration.sqlite()
    private static let haskell = LanguageConfiguration.haskell()
    private static let agda = LanguageConfiguration.agda()
    private static let cabal = LanguageConfiguration.cabal()
    private static let cypher = LanguageConfiguration.cypher()

    static func configuration(_ language: String) -> LanguageConfiguration {
        switch language.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "swift", ".swift": return swift
        case "python", "py", "pyi", ".py": return python
        case "sql", "sqlite": return sqlite
        case "haskell", "hs", "lhs": return haskell
        case "agda": return agda
        case "cabal": return cabal
        case "cypher": return cypher
        default: return .none
        }
    }
}

@MainActor
struct XgentCodeEditor: View {
    @Binding var text: String
    let language: String
    let label: String
    var enabled = true
    var wrapText = true
    var showsMinimap = false
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 13
    @State private var position = CodeEditor.Position()
    @State private var messages: Set<TextLocated<LanguageSupport.Message>> = []
    @State private var editorTheme = CodeEditorView.Theme.defaultLight

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var styleKey: String {
        "\(colorScheme)-\(fontSize)-\(theme.fontScale)-\(palette.text)-\(palette.surface)"
    }

    var body: some View {
        Group {
            if enabled {
                CodeEditor(text: $text, position: $position, messages: $messages,
                           language: XgentCodeLanguages.configuration(language))
                    .environment(\.codeEditorTheme, editorTheme)
                    .environment(\.codeEditorLayoutConfiguration,
                                 CodeEditor.LayoutConfiguration(showMinimap: showsMinimap, wrapText: wrapText))
                    .accessibilityLabel(label)
            } else {
                XgentCodeBlock(text: text, language: language, label: label)
            }
        }
        .frame(minHeight: 180)
        .clipShape(RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element))
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
        .onChange(of: styleKey, initial: true) {
            // Theme mutations change its identity; keep it stable during typing and selection updates.
            var next = colorScheme == .dark ? CodeEditorView.Theme.defaultDark : .defaultLight
            next.fontSize = fontSize * CGFloat(theme.fontScale)
            #if os(iOS)
            next.textColour = UIColor(Color(xgentHex: palette.text))
            next.backgroundColour = UIColor(Color(xgentHex: palette.surface))
            #else
            next.textColour = NSColor(Color(xgentHex: palette.text))
            next.backgroundColour = NSColor(Color(xgentHex: palette.surface))
            #endif
            editorTheme = next
        }
    }
}
