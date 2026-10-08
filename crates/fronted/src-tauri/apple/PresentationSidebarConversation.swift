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
    @ScaledMetric(relativeTo: .body) private var textScale = 1.0

    private var rowHeight: CGFloat {
        #if os(iOS)
        44
        #else
        32
        #endif
    }

    private var labelFont: Font {
        #if os(iOS)
        XgentFonts.body(theme.fontFamily, size: CGFloat(17 * theme.fontScale) * textScale)
        #else
        // ChatHistorySidebar's project/history titles use 14px scaled text.
        XgentFonts.body(theme.fontFamily, size: CGFloat(14 * theme.fontScale) * textScale)
        #endif
    }

    private var menu: XgentNode? { node.children?.first { $0.kind == .menu } }
    private var disclosure: XgentNode? { node.children?.first { $0.variant == "sidebar-disclosure" } }
    private var palette: XgentPalette { theme.palette(for: colorScheme) }

    private var title: some View {
        Text(node.label ?? "")
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
            .truncationMode(.tail)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var stateIndicator: some View {
        if node.status == "running" {
            ProgressView().controlSize(.small).tint(Color(xgentHex: palette.accent)).accessibilityHidden(true)
        }
    }

    @ViewBuilder private var selectionLabel: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                title.frame(maxWidth: .infinity, alignment: .leading)
                if node.icon != nil || node.status == "running" {
                    HStack(spacing: 8) {
                        if let icon = node.icon {
                            Image(systemName: icon).font(.caption).accessibilityHidden(true)
                        }
                        stateIndicator
                    }
                }
            }
        } else {
            HStack(spacing: 8) {
                if let icon = node.icon {
                    Image(systemName: icon).font(.caption).accessibilityHidden(true)
                }
                title
                Spacer(minLength: 0)
                stateIndicator
            }
        }
    }

    var body: some View {
        HStack(alignment: dynamicTypeSize.isAccessibilitySize ? .top : .center, spacing: 4) {
            if let disclosure {
                Button { model.send(disclosure, in: document) } label: {
                    Image(systemName: disclosure.icon ?? "chevron.forward")
                        .font(.caption.weight(.semibold))
                        .frame(width: rowHeight, height: rowHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(disclosure.disabled == true || model.isBusy(disclosure, in: document))
                .accessibilityIdentifier(disclosure.id)
                .accessibilityLabel(disclosure.accessibilityLabel ?? disclosure.label ?? "")
                .help(disclosure.label ?? "")
            }
            Button { model.send(node, in: document) } label: {
                selectionLabel
                    .padding(.horizontal, 8)
                    .padding(.vertical, rowHeight == 44 ? 8 : 4)
                    .frame(maxWidth: .infinity, minHeight: rowHeight, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // Archived project selection is disabled; the sibling restore menu stays usable.
            .disabled(node.disabled == true ||
                      (node.variant == "sidebar-workspace-row" && node.secondary == true) ||
                      model.isBusy(node, in: document))
            .contextMenu {
                if let menu {
                    XgentNativeMenuItems(nodes: menu.children ?? [], document: document, model: model)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(node.id)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            .help(node.label ?? "")
            .accessibilityValue(node.accessibilityValue ?? "")
            .accessibilityAddTraits(node.selected == true ? [.isButton, .isSelected] : .isButton)
            if let menu {
                XgentNativeMenu(node: menu, document: document, model: model)
                    .accessibilityIdentifier(menu.id)
                    .fixedSize()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .font(labelFont)
        .foregroundStyle(Color(xgentHex: node.secondary == true ? palette.secondaryText : palette.text))
        .background(node.selected == true ? Color(xgentHex: palette.neutral ?? palette.muted) : .clear,
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .accessibilityElement(children: .contain)
    }
}
