#if os(macOS)
import SwiftUI

struct XgentWorkspacePanelTab: View {
    let tab: XgentWindowToolbarTab
    let select: () -> Void
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 0) {
            Button(action: select) {
                Text(tab.title).lineLimit(1).frame(maxWidth: 180)
                    .padding(.horizontal, 8).padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            .disabled(tab.action?.disabled == true || tab.action.map { model.isBusy($0, in: tab.document) } == true)
            .help(tab.subtitle.isEmpty ? tab.title : tab.subtitle)
            .accessibilityAddTraits(tab.selected ? [.isSelected] : [])
            .accessibilityIdentifier("xgent-workspace-tab:\(tab.id)")
            if let close = tab.closeAction ?? (tab.selected && tab.action?.id == "terminal-session" ? tab.document.node(id: "terminal-end") : nil) {
                let label = close.label ?? tab.document.workspacePanel?.closeTabLabel ?? ""
                Button { tab.close(model) } label: {
                    Image(systemName: "xmark").frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .disabled(close.disabled == true || model.isBusy(close, in: tab.document))
                .help(label)
                .accessibilityLabel("\(label): \(tab.title)")
                .accessibilityIdentifier("xgent-workspace-tab-close:\(tab.id)")
            } else if tab.action == nil && tab.document.dismissAction != nil {
                Button { tab.close(model) } label: { Image(systemName: "xmark").frame(width: 28, height: 28) }
                    .buttonStyle(.plain)
                    .disabled(model.isDismissing(tab.document))
                    .accessibilityLabel("\(tab.document.workspacePanel?.closeTabLabel ?? tab.document.workspacePanel?.closeLabel ?? ""): \(tab.title)")
                    .accessibilityIdentifier("xgent-workspace-tab-close:\(tab.id)")
            }
        }
        .background(tab.selected ? Color(xgentHex: theme.palette(for: scheme).muted) : .clear,
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner)))
        .accessibilityElement(children: .contain)
    }
}
#endif
