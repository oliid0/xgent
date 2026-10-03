import SwiftUI
import Flow

struct XgentCodeEditingToolbar: View {
    let labels: XgentCodeEditingLabels
    @ObservedObject var commands: XgentCodeEditingCommands
    var nativeFind: ((Bool) -> Void)? = nil
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .callout) private var fontScale = 1.0

    var body: some View {
        HFlow(alignment: .top, spacing: 6) {
            action(labels.find, icon: "magnifyingglass", id: "find", enabled: commands.attached) { commands.find(replacing: false, native: nativeFind) }
                #if os(macOS)
                .keyboardShortcut("f", modifiers: .command)
                #endif
            action(labels.replace, icon: "arrow.triangle.2.circlepath", id: "replace", enabled: commands.attached) { commands.find(replacing: true, native: nativeFind) }
                #if os(macOS)
                .keyboardShortcut("f", modifiers: [.command, .option])
                #endif
            action(labels.copy, icon: "doc.on.doc", id: "copy", enabled: commands.attached) { commands.copy() }
            action(labels.undo, icon: "arrow.uturn.backward", id: "undo", enabled: commands.canUndo) { commands.undo() }
            action(labels.redo, icon: "arrow.uturn.forward", id: "redo", enabled: commands.canRedo) { commands.redo() }
        }
        .padding(8)
        .background(Color(xgentHex: theme.palette(for: colorScheme).surface))
    }

    private func action(_ label: String, icon: String, id: String, enabled: Bool,
                        perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Label(label, systemImage: icon)
                .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * fontScale))
                .frame(minHeight: 32)
                .padding(.horizontal, 4)
                #if os(iOS)
                .frame(minHeight: 44)
                #endif
        }
        .buttonStyle(.borderless)
        .disabled(!enabled)
        .accessibilityIdentifier("workspace-file-\(id)")
        .help(label)
    }
}
