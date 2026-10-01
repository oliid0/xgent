import SwiftUI

// Keep conversation selection and its action menu as separate controls.
// Both the visible menu and the system context menu use registered actions.
struct XgentSidebarConversationRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var menu: XgentNode? { node.children?.first { $0.kind == .menu } }
    private var palette: XgentPalette { theme.palette(for: colorScheme) }

    var body: some View {
        HStack(spacing: 4) {
            Button { model.send(node, in: document) } label: {
                HStack(spacing: 8) {
                    if let icon = node.icon {
                        Image(systemName: icon).font(.caption).accessibilityHidden(true)
                    }
                    Text(node.label ?? "")
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if node.status == "running" {
                        ProgressView().controlSize(.small).accessibilityHidden(true)
                    } else if node.selected == true {
                        Circle().fill(Color(xgentHex: palette.accent)).frame(width: 6, height: 6)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(node.disabled == true || model.isBusy(node, in: document))
            .accessibilityIdentifier(node.id)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            .accessibilityValue(node.accessibilityValue ?? "")
            .accessibilityAddTraits(node.selected == true ? .isSelected : [])
            .contextMenu {
                if let menu {
                    XgentNativeMenuItems(nodes: menu.children ?? [], document: document, model: model)
                }
            }
            if let menu {
                XgentNativeMenu(node: menu, document: document, model: model)
                    .accessibilityIdentifier(menu.id)
                    .fixedSize()
            }
        }
        .modifier(XgentControlTypography(node: node))
        .foregroundStyle(Color(xgentHex: palette.text))
        .background(node.selected == true ? Color(xgentHex: palette.neutral ?? palette.muted) : .clear,
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .accessibilityElement(children: .contain)
    }
}
