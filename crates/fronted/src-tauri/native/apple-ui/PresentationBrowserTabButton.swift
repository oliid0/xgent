import SwiftUI

struct XgentBrowserTabButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.colorScheme) private var scheme
    @Environment(\.xgentPresentationTheme) private var theme

    var body: some View {
        Button { model.send(node, in: document) } label: {
            VStack(spacing: 4) {
                HStack(spacing: 6) {
                    if node.status == "running" { ProgressView().controlSize(.small) }
                    else { Image(systemName: "globe").foregroundStyle(.secondary).accessibilityHidden(true) }
                    Text(node.label ?? "").modifier(XgentControlTypography(node: node))
                        .lineLimit(1).truncationMode(.tail)
                }
                .padding(.horizontal, 10).padding(.top, 8)
                Rectangle().fill(node.selected == true ? Color(xgentHex: theme.palette(for: scheme).accent) : .clear)
                    .frame(height: 2)
            }
            .frame(minWidth: 80, maxWidth: 200, minHeight: document.formFactor == .mobile ? 44 : 32)
            .background(node.selected == true ? Color(xgentHex: theme.palette(for: scheme).muted) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.label ?? "")
        .accessibilityHint(node.text ?? "")
        .accessibilityAddTraits(node.selected == true ? [.isSelected] : [])
        #if os(macOS)
        .help(node.text ?? node.label ?? "")
        #endif
    }
}
