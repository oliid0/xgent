#if os(macOS)
import SwiftUI

struct XgentWorkspacePanelTab: View {
    let document: XgentDocument
    let selected: Bool
    let select: () -> Void
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 0) {
            Button(action: select) {
                Text(document.title).lineLimit(1).frame(maxWidth: 180)
                    .padding(.horizontal, 8).padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            .help(document.title)
            .accessibilityAddTraits(selected ? [.isSelected] : [])
            .accessibilityIdentifier("xgent-workspace-tab:\(document.surface)")
            if document.dismissAction != nil {
                let label = document.workspacePanel?.closeTabLabel ?? document.workspacePanel?.closeLabel ?? ""
                Button { model.dismiss(document) } label: {
                    Image(systemName: "xmark").frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .disabled(model.isDismissing(document))
                .help(label)
                .accessibilityLabel("\(label): \(document.title)")
                .accessibilityIdentifier("xgent-workspace-tab-close:\(document.surface)")
            }
        }
        .background(selected ? Color(xgentHex: theme.palette(for: scheme).muted) : .clear,
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner)))
        .accessibilityElement(children: .contain)
    }
}
#endif
