import SwiftUI

struct XgentTaskProgressStep: View {
    let node: XgentNode
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .body) private var bodyScale = 1.0
    @ScaledMetric(relativeTo: .caption) private var detailScale = 1.0

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            XgentTaskStatusGlyph(status: node.status)
            VStack(alignment: .leading, spacing: 4) {
                Text(node.label ?? "")
                    .font(XgentFonts.body(theme.fontFamily,
                        size: CGFloat(theme.typography.body * theme.fontScale) * bodyScale,
                        weight: node.status == "running" ? .semibold : .regular))
                    .foregroundStyle(node.status == "pending" ? Color.secondary : Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if let text = node.text, !text.isEmpty, text != node.label {
                    Text(text)
                        .font(XgentFonts.body(theme.fontFamily,
                            size: CGFloat(theme.typography.caption * theme.fontScale) * detailScale))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(node.accessibilityValue ?? "")
        .accessibilityIdentifier(node.id)
    }
}
