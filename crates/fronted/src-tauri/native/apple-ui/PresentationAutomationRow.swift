import Flow
import SwiftUI

struct XgentAutomationRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    private var items: [XgentNode] { node.children ?? [] }
    private var metadata: [XgentNode] { items.filter { $0.kind == .badge } }
    private var actions: [XgentNode] { items.filter { $0.kind == .iconButton || $0.kind == .button } }
    private var content: [XgentNode] {
        items.filter { $0.kind != .badge && $0.kind != .iconButton && $0.kind != .button }
    }

    @ViewBuilder private func render(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(node.label ?? "", systemImage: node.icon ?? "clock")
                .fontWeight(.semibold).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            HFlow(itemSpacing: 8, rowSpacing: 8) {
                ForEach(metadata) { render($0) }
            }
            ForEach(content) { render($0) }
            HFlow(itemSpacing: 8, rowSpacing: 8) {
                ForEach(actions) { render($0) }
            }
        }
        .modifier(XgentControlTypography(node: node))
        .padding(CGFloat(theme.spacing.md))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: theme.palette(for: scheme).surface),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element))
                .stroke(Color(xgentHex: theme.palette(for: scheme).border))
                .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
    }
}
