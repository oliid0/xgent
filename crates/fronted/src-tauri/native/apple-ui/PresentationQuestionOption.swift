import SwiftUI

struct XgentQuestionOptionButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .subheadline) private var detailScale = 1.0

    var body: some View {
        let palette = theme.palette(for: scheme)
        Button { model.send(node, in: document) } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: node.selected == true ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(Color(xgentHex: node.selected == true ? palette.accentText : palette.secondaryText))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(node.label ?? "").fixedSize(horizontal: false, vertical: true)
                    if let detail = node.text, !detail.isEmpty {
                        Text(detail)
                            .font(XgentFonts.body(theme.fontFamily,
                                size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale))
                            .foregroundStyle(Color(xgentHex: palette.secondaryText))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let recommended = node.children?.first {
                        Text(recommended.label ?? "")
                            .font(XgentFonts.body(theme.fontFamily,
                                size: CGFloat(theme.typography.caption * theme.fontScale) * detailScale))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.orange.opacity(0.12), in: Capsule())
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            .modifier(XgentControlTypography(node: node))
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .background(Color(xgentHex: node.selected == true ? palette.muted : palette.surface),
                in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner)))
            .overlay {
                RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner))
                    .stroke(Color(xgentHex: node.selected == true ? palette.accent : palette.border), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        .accessibilityHint(node.text ?? "")
        .accessibilityAddTraits(.isButton)
        .accessibilityAddTraits(node.selected == true ? .isSelected : [])
        .accessibilityIdentifier(node.id)
    }
}
