import SwiftUI
import Flow

// Calendar, Contacts and Home expose observed data, without a navigation target.
struct XgentConnectorDataRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 24
    @ScaledMetric(relativeTo: .subheadline) private var detailScale = 1.0

    private var iconColor: Color {
        switch node.icon {
        case "calendar": return Color(xgentHex: "#FF3B30")
        case "checklist": return Color(xgentHex: "#007AFF")
        case "house", "square.grid.2x2", "lightbulb", "sparkles": return Color(xgentHex: "#F5A623")
        default: return Color(xgentHex: theme.palette(for: scheme).secondaryText)
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: node.icon ?? "doc")
                .font(.system(size: iconSize, weight: .regular))
                .foregroundStyle(iconColor)
                .frame(width: max(40, iconSize + 12), height: max(40, iconSize + 12))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(node.label ?? "")
                    .fixedSize(horizontal: false, vertical: true)
                if let text = node.text, !text.isEmpty {
                    Text(text).font(XgentFonts.body(theme.fontFamily,
                        size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale))
                        .foregroundStyle(Color(xgentHex: theme.palette(for: scheme).secondaryText))
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let actions = node.children, !actions.isEmpty {
                    HFlow(itemSpacing: 8, rowSpacing: 8) {
                        ForEach(actions) { action in
                            XgentActionButton(node: action, document: document, model: model)
                                .accessibilityLabel("\(node.label ?? "") · \(action.label ?? "")")
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .modifier(XgentControlTypography(node: node))
        .padding(.horizontal, CGFloat(theme.spacing.lg))
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        .textSelection(.enabled)
        .accessibilityElement(children: (node.children ?? []).isEmpty ? .combine : .contain)
        .accessibilityIdentifier(node.id)
    }
}

struct XgentConnectorDataList: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array((node.children ?? []).enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider().padding(.leading, CGFloat(theme.spacing.lg) + 54) }
                XgentConnectorDataRow(node: row, document: document, model: model)
            }
        }
        .background(Color(xgentHex: theme.palette(for: scheme).muted),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.container)))
        .accessibilityElement(children: .contain)
    }
}
