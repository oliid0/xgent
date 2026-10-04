import SwiftUI

struct XgentSidebarSectionHeading: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .subheadline) private var scale = 1.0

    var body: some View {
        HStack(spacing: 8) {
            Text(node.text ?? node.label ?? "")
                .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * scale, weight: .semibold))
                .foregroundStyle(Color(xgentHex: theme.palette(for: scheme).secondaryText))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            ForEach(node.children ?? []) { action in
                if action.kind == .menu {
                    XgentNativeMenu(node: action, document: document, model: model)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
