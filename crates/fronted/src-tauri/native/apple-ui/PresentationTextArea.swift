import SwiftUI
#if os(iOS)
import SwiftUIIntrospect
#endif

// A multiline form field owns its scrolling height. It must not expand into
// the enclosing settings Form or steal that Form's vertical layout space.
struct XgentTextArea: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.locale) private var locale
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.isEnabled) private var enabled

    private var text: Binding<String> {
        let field = node, surface = document
        return Binding(get: { [weak model] in model?.value(field, in: surface).text ?? field.value?.text ?? "" },
                       set: { [weak model] in model?.send(field, in: surface, value: .string($0), editing: true) })
    }

    private var findSender: ((XgentCodeFindAction) -> Void)? {
        guard node.variant == "workspace-code-editor", let control = document.node(id: "workspace-file-find-action") else { return nil }
        let surface = document
        return { [weak model] action in
            guard let value = action.encoded else { return }
            model?.send(control, in: surface, value: .string(value), editing: true)
        }
    }

    private func codeEditor(_ language: String) -> XgentCodeEditor {
        XgentCodeEditor(text: text, language: language, label: node.label ?? language,
                        enabled: node.disabled != true,
                        wrapText: node.wrap ?? (document.formFactor != .desktop),
                        showsMinimap: document.formFactor == .desktop,
                        reveal: node.variant == "workspace-code-editor" ? XgentCodeLocation.decode(node.text) : nil,
                        editingLabels: node.variant == "workspace-code-editor" ? XgentCodeEditingLabels.decode(node.text) : nil,
                        session: node.variant == "workspace-code-editor" ? XgentCodeSessionIdentity.decode(node.text) : nil,
                        sessionStore: model.codeSessions,
                        find: node.variant == "workspace-code-editor" ? XgentCodeFindConfiguration.decode(node.text) : nil,
                        syntax: node.variant == "workspace-code-editor" ? XgentCodeSyntaxConfiguration.decode(node.text) : nil,
                        findAction: findSender)
    }

    @ViewBuilder private var editor: some View {
        if let language = node.language, !language.isEmpty {
            if node.variant == "workspace-code-editor", let session = XgentCodeSessionIdentity.decode(node.text) {
                let binding = text
                XgentRetainedCodeEditor(session: session, store: model.codeHosts, configuration: codeEditor(language),
                                        content: binding.wrappedValue,
                                        environment: .init(theme: theme, colorScheme: colorScheme, dynamicTypeSize: dynamicTypeSize,
                                                           locale: locale, layoutDirection: layoutDirection, enabled: enabled),
                                        changed: { binding.wrappedValue = $0 })
                    .frame(minHeight: max(180, CGFloat(node.minHeight ?? 112)))
            } else {
                codeEditor(language)
                    .id("\(document.surface):\(node.id)")
                    .frame(minHeight: CGFloat(node.minHeight ?? 112))
            }
        } else {
            TextEditor(text: text)
                .scrollContentBackground(.hidden)
                #if os(iOS)
                .introspect(.textEditor, on: .iOS(.v26)) { textView in
                    textView.keyboardDismissMode = .interactive
                }
                #endif
                .frame(minHeight: CGFloat(node.minHeight ?? 112))
                .modifier(XgentFieldSurface(node: node))
                .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            XgentFieldLabel(node: node)
            editor
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .disabled(node.disabled == true)
    }
}
