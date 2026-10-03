import SwiftUI

// A server is one semantic row, with transport/configuration metadata kept
// above its endpoint and independent enable, permission, edit and delete actions.
struct XgentMCPServerRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: node.icon ?? "server.rack")
                    .foregroundStyle(node.selected == true ? Color.accentColor : Color.secondary)
                    .accessibilityHidden(true)
                Text(node.label ?? "")
                    .modifier(XgentControlTypography(node: node)).fontWeight(.semibold)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("\(node.id):name")
            }
            ForEach((node.children ?? []).filter { $0.variant != "mcp-server-actions" }) { content($0) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var actions: some View {
        if let item = node.children?.first(where: { $0.variant == "mcp-server-actions" }) { content(item) }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 16) { summary; actions }
    }

    var body: some View {
        Group {
            if document.formFactor == .mobile || textSize.isAccessibilitySize { vertical }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 24) {
                        summary.frame(minWidth: 240)
                        actions
                    }
                    vertical
                }
            }
        }
        .padding(16)
        .background(Color(xgentHex: theme.palette(for: colorScheme).surface),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element))
                .stroke(Color(xgentHex: theme.palette(for: colorScheme).border), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }
}
