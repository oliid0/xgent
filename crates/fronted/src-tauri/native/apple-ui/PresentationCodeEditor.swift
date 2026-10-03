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
    var reveal: XgentCodeLocation? = nil
    var editingLabels: XgentCodeEditingLabels? = nil
    var session: XgentCodeSessionIdentity? = nil
    var sessionStore: XgentCodeSessionStore? = nil
    var find: XgentCodeFindConfiguration? = nil
    var syntax: XgentCodeSyntaxConfiguration? = nil
    var findAction: ((XgentCodeFindAction) -> Void)? = nil
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 13
    @State private var position = CodeEditor.Position()
    @StateObject private var sessionOwner = XgentCodeSessionOwner()
    @State private var messages: Set<TextLocated<LanguageSupport.Message>> = []
    @State private var editorTheme = CodeEditorView.Theme.defaultLight
    @State private var revealedRequest: String?
    @StateObject private var editingCommands = XgentCodeEditingCommands()

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var positionBinding: Binding<CodeEditor.Position> {
        Binding(get: {
            if let session, let sessionStore {
                sessionOwner.prepare(session, store: sessionStore)
                return sessionStore.position(session, text: text)
            }
            return position
        }, set: { value in
            let next = XgentCodeSessionPosition.clamp(value, in: text)
            if let session, let sessionStore {
                sessionStore.save(next, session: session, owner: sessionOwner.id, text: text)
            } else {
                position = next
            }
        })
    }
    private var styleKey: String {
        "\(colorScheme)-\(fontSize)-\(theme.fontScale)-\(theme.codeFontFamily ?? "")-\(palette.text)-\(palette.surface)"
    }

    var body: some View {
        VStack(spacing: 0) {
            if enabled, let editingLabels {
                XgentCodeEditingToolbar(labels: editingLabels, commands: editingCommands,
                    nativeFind: find == nil ? nil : { replacing in
                        guard let find else { return }
                        performFind(replacing ? "openReplace" : "open", draft: XgentCodeFindDraft(find))
                    })
                Divider()
            }
            if enabled, let find, find.open {
                XgentCodeFindBar(configuration: find, perform: performFind).id(find.identity)
                Divider()
            }
            if enabled {
                CodeEditor(text: $text, position: positionBinding, messages: $messages,
                           language: XgentCodeLanguages.configuration(language))
                    .environment(\.codeEditorTheme, editorTheme)
                    .environment(\.codeEditorLayoutConfiguration,
                                 CodeEditor.LayoutConfiguration(showMinimap: showsMinimap, wrapText: wrapText))
                    .modifier(XgentCodeSessionViewport(session: session, store: sessionStore, owner: sessionOwner.id, reveal: reveal))
                    .modifier(XgentCodeRevealModifier(location: reveal, text: text, session: session, store: sessionStore, owner: sessionOwner.id))
                    .modifier(XgentCodeEditingTarget(commands: editingCommands))
                    .modifier(XgentCodeFindTarget(configuration: find, acknowledge: findAction, session: session, store: sessionStore, owner: sessionOwner.id))
                    .modifier(XgentCodeFindHighlightModifier(configuration: find, syntax: syntax, session: session, store: sessionStore, owner: sessionOwner.id))
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
            if let name = XgentFonts.name(for: theme.codeFontFamily) { next.fontName = name }
            #if os(iOS)
            next.textColour = UIColor(Color(xgentHex: palette.text))
            next.backgroundColour = UIColor(Color(xgentHex: palette.surface))
            #else
            next.textColour = NSColor(Color(xgentHex: palette.text))
            next.backgroundColour = NSColor(Color(xgentHex: palette.surface))
            #endif
            editorTheme = next
        }
        .onAppear { sessionOwner.appear(session, store: sessionStore) }
        .onChange(of: reveal, initial: true) {
            guard let reveal, revealedRequest != reveal.request else { return }
            if let session, let sessionStore, sessionStore.revealed(reveal.request, session: session) { return }
            var next = positionBinding.wrappedValue
            next.selections = [reveal.range(in: text)]
            positionBinding.wrappedValue = next
            revealedRequest = reveal.request
        }
    }
    private func performFind(_ command: String, draft: XgentCodeFindDraft) {
        guard let snapshot = editingCommands.snapshot() else { return }
        findAction?(XgentCodeFindAction(command: command, content: snapshot.content, query: draft.query,
                                       replacement: draft.replacement, options: draft.options, selections: snapshot.selections))
    }
    func retained(binding: Binding<String>) -> Self {
        var next = self
        next._text = binding
        // Read-only state is applied to the existing native editor rather than
        // replacing its view (and therefore losing its undo operations).
        next.enabled = true
        return next
    }
}
