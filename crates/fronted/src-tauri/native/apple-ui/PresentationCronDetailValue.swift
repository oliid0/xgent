import SwiftUI

struct XgentCronDetailValue: View {
    let node: XgentNode
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .subheadline) private var scale = 1.0

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(node.label ?? "")
                .foregroundStyle(.secondary)
                .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * scale))
                .fixedSize(horizontal: false, vertical: true)
            Text(node.text ?? "")
                .modifier(XgentControlTypography(node: node))
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
