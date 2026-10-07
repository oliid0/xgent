import Flow
import SwiftUI

// Keep the saved host's identity, authentication and actions in one card.
// Flexible action flow leaves endpoint text readable at narrow widths.
struct XgentSSHHostRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    private var endpoint: XgentNode? { node.children?.first { $0.id.hasSuffix(":edit") } }
    private var actions: [XgentNode] {
        (node.children ?? []).filter { $0.action != nil }
    }
    private var metadata: [XgentNode] {
        (node.children ?? []).filter { $0.kind == .badge || $0.kind == .statusDot }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(node.label ?? "", systemImage: node.icon ?? "server.rack")
                .fontWeight(.semibold).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let endpoint {
                Text(endpoint.label ?? "").font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            HFlow(itemSpacing: 8, rowSpacing: 8) {
                ForEach(metadata) { item in
                    XgentNodeView(node: item, document: document, model: model)
                }
            }
            HFlow(itemSpacing: 8, rowSpacing: 8) {
                ForEach(actions) { action in
                    Button { model.send(action, in: document) } label: {
                        Image(systemName: action.id.hasSuffix(":edit") ? "pencil" : action.icon ?? "trash")
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(action.destructive == true ? Color.red : Color.primary)
                    .disabled(action.disabled == true || model.isBusy(action, in: document))
                    .accessibilityIdentifier(action.id)
                    .accessibilityLabel(action.accessibilityLabel ?? action.label ?? "")
                }
            }
        }
        .modifier(XgentControlTypography(node: node))
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: theme.palette(for: scheme).surface),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .overlay(RoundedRectangle(cornerRadius: CGFloat(theme.radius.element))
            .stroke(Color(xgentHex: theme.palette(for: scheme).border)).allowsHitTesting(false))
        .accessibilityElement(children: .contain)
    }
}
