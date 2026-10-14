import SwiftUI

struct XgentCronDetailValue: View {
    let node: XgentNode
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .subheadline) private var scale = 1.0
    @Environment(\.dynamicTypeSize) private var textSize

    private var label: some View {
        Text(node.label ?? "")
            .foregroundStyle(.secondary)
            .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * scale))
            .fixedSize(horizontal: false, vertical: true)
    }
    private var value: some View {
        Text(node.text ?? "")
            .modifier(XgentControlTypography(node: node))
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    var body: some View {
        Group {
            if textSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 5) { label; value }
            } else {
                HStack(alignment: .top, spacing: 16) {
                    label.frame(width: 110, alignment: .leading)
                    value.frame(maxWidth: .infinity, alignment: .trailing)
                        .multilineTextAlignment(.trailing)
                }
            }
        }
        .padding(.vertical, CGFloat(theme.spacing.sm))
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
