import SwiftUI

// Opening the task list must not insert it into the composer and displace input.
struct XgentTaskProgressChip: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var open = false
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button { open.toggle() } label: {
            HStack(alignment: .center, spacing: 8) {
                XgentTaskStatusGlyph(status: node.status)
                Text(node.label ?? "")
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(node.text ?? "").monospacedDigit().foregroundStyle(.secondary)
                    .fixedSize(horizontal: true, vertical: false)
                Image(systemName: open ? "chevron.up" : "chevron.down")
                    .font(.caption).accessibilityHidden(true)
            }
            .modifier(XgentControlTypography(node: node))
            .padding(.horizontal, 10).padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true)
        .accessibilityLabel(node.label ?? "")
        .accessibilityValue(node.accessibilityValue ?? node.text ?? "")
        .accessibilityIdentifier(node.id)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            XgentTaskProgressPopover(node: node, document: document, model: model)
                #if os(iOS)
                .presentationCompactAdaptation(.popover)
                #endif
        }
        .onChange(of: node.id) { _, _ in open = false }
        .background(Color(xgentHex: theme.palette(for: scheme).surface).opacity(0.78),
            in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
    }
}
