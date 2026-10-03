import SwiftUI
import Flow

@MainActor
struct XgentCodeFindBar: View {
    let configuration: XgentCodeFindConfiguration
    let perform: (String, XgentCodeFindDraft) -> Void
    @State private var draft: XgentCodeFindDraft
    @FocusState private var focus: Field?
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .callout) private var scale = 1.0
    private enum Field { case query, replacement }

    init(configuration: XgentCodeFindConfiguration, perform: @escaping (String, XgentCodeFindDraft) -> Void) {
        self.configuration = configuration; self.perform = perform
        _draft = State(initialValue: XgentCodeFindDraft(configuration))
    }
    private var labels: XgentCodeFindLabels { configuration.labels }
    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var status: String { "\(configuration.current) / \(configuration.count)\(configuration.limited ? "+" : "")" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(labels.query, text: $draft.query)
                .textFieldStyle(.plain)
                .focused($focus, equals: .query)
                .onSubmit { perform("next", draft) }
                .accessibilityIdentifier("workspace-file-find-query")
                .modifier(XgentCodeFindFieldSurface())
            if configuration.replacing {
                TextField(labels.replacement, text: $draft.replacement)
                    .textFieldStyle(.plain)
                    .focused($focus, equals: .replacement)
                    .onSubmit { perform("replace", draft) }
                    .accessibilityIdentifier("workspace-file-find-replacement")
                    .modifier(XgentCodeFindFieldSurface())
            }
            HFlow(alignment: .top, spacing: 6) {
                option(labels.matchCase, icon: "textformat", value: $draft.options.matchCase)
                    #if os(macOS)
                    .keyboardShortcut("c", modifiers: [.command, .option])
                    #endif
                option(labels.wholeWord, icon: "textformat.abc", value: $draft.options.wholeWord)
                    #if os(macOS)
                    .keyboardShortcut("w", modifiers: [.command, .option])
                    #endif
                option(labels.regex, icon: "asterisk", value: $draft.options.regex)
                    #if os(macOS)
                    .keyboardShortcut("r", modifiers: [.command, .option])
                    #endif
                option(labels.selection, icon: "selection.pin.in.out", value: $draft.options.selection)
                    #if os(macOS)
                    .keyboardShortcut("l", modifiers: [.command, .option])
                    #endif
                if configuration.replacing {
                    option(labels.preserveCase, icon: "textformat.size", value: $draft.options.preserveCase)
                        #if os(macOS)
                        .keyboardShortcut("p", modifiers: [.command, .option])
                        #endif
                }
            }
            HFlow(alignment: .center, spacing: 6) {
                Text(status).monospacedDigit().accessibilityIdentifier("workspace-file-find-count")
                action(labels.previous, icon: "chevron.up", command: "previous", disabled: configuration.count == 0)
                    #if os(macOS)
                    .keyboardShortcut("g", modifiers: [.command, .shift])
                    #endif
                action(labels.next, icon: "chevron.down", command: "next", disabled: configuration.count == 0)
                    #if os(macOS)
                    .keyboardShortcut("g", modifiers: .command)
                    #endif
                if configuration.replacing {
                    action(labels.replace, icon: "arrow.triangle.2.circlepath", command: "replace", disabled: configuration.count == 0 || configuration.edit != nil)
                    action(labels.replaceAll, icon: "arrow.triangle.2.circlepath", command: "replaceAll", disabled: configuration.count == 0 || configuration.edit != nil)
                }
                action(labels.close, icon: "xmark", command: "close", disabled: false)
                    #if os(macOS)
                    .keyboardShortcut(.cancelAction)
                    #endif
            }
            if configuration.invalid || configuration.rejected {
                Text(configuration.invalid ? labels.invalid : labels.rejected)
                    .foregroundStyle(Color(xgentHex: palette.error ?? "#e3193b"))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("workspace-file-find-error")
            }
            if draft.options.selection && !configuration.hasSelection {
                Text(labels.noSelection).foregroundStyle(Color(xgentHex: palette.secondaryText))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * scale))
        .padding(10)
        .background(Color(xgentHex: palette.surface))
        #if os(iOS)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        #endif
        .onChange(of: draft) { perform("query", draft) }
        .onChange(of: configuration.replacing) { focus = configuration.replacing ? .replacement : .query }
        .onAppear { focus = configuration.replacing ? .replacement : .query }
    }

    private func option(_ label: String, icon: String, value: Binding<Bool>) -> some View {
        Button { value.wrappedValue.toggle() } label: {
            Label(label, systemImage: icon)
                #if os(iOS)
                .labelStyle(.iconOnly)
                .frame(minWidth: 44)
                #endif
                .padding(.horizontal, 6).frame(minHeight: targetHeight)
        }
        .buttonStyle(.borderless)
        .background(value.wrappedValue ? Color(xgentHex: palette.muted) : .clear, in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .accessibilityValue(value.wrappedValue ? "1" : "0")
        .accessibilityLabel(label)
        .accessibilityAddTraits(value.wrappedValue ? .isSelected : [])
        .help(label)
    }
    private var targetHeight: CGFloat {
        #if os(iOS)
        return max(44, CGFloat(theme.control.small))
        #else
        return max(28, CGFloat(theme.control.small))
        #endif
    }
    private func action(_ label: String, icon: String, command: String, disabled: Bool) -> some View {
        Button { perform(command, draft) } label: {
            Label(label, systemImage: icon)
                #if os(iOS)
                .labelStyle(command == "replace" || command == "replaceAll" ? XgentFindActionLabelStyle.textAndIcon : .icon)
                .frame(minWidth: 44)
                #endif
                .padding(.horizontal, 4).frame(minHeight: targetHeight)
        }
        .buttonStyle(.borderless).disabled(disabled)
        .accessibilityIdentifier("workspace-file-find-\(command)").help(label)
        .accessibilityLabel(label)
    }
}

private struct XgentFindActionLabelStyle: LabelStyle {
    let showsTitle: Bool
    static let textAndIcon = Self(showsTitle: true)
    static let icon = Self(showsTitle: false)
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) { configuration.icon; if showsTitle { configuration.title } }
    }
}

private struct XgentCodeFindFieldSurface: ViewModifier {
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    func body(content: Content) -> some View {
        content.padding(.horizontal, 10)
            #if os(iOS)
            .frame(minHeight: max(44, CGFloat(theme.control.medium)))
            #else
            .frame(minHeight: max(30, CGFloat(theme.control.small)))
            #endif
            .background(Color(xgentHex: theme.palette(for: colorScheme).background), in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
            .overlay { RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)).stroke(Color(xgentHex: theme.palette(for: colorScheme).border), lineWidth: 1) }
    }
}
