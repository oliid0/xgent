import SwiftUI

struct XgentCronRunRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    private var summary: XgentNode? { node.children?.first { $0.kind == .button } }
    private var details: [XgentNode] { node.children?.filter { $0.kind != .button } ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let summary {
                Button { model.send(summary, in: document) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Image(systemName: node.status == "running" ? "clock" : node.status == "completed" ? "checkmark.circle" : "exclamationmark.circle")
                            .foregroundStyle(node.status == "error" ? Color.red : Color.secondary)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(summary.label ?? "").fixedSize(horizontal: false, vertical: true)
                            Text(summary.text ?? "").foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: summary.selected == true ? "chevron.down" : "chevron.right").accessibilityHidden(true)
                    }
                    .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(summary.disabled == true || model.isBusy(summary, in: document))
                .accessibilityIdentifier(summary.id)
            }
            ForEach(details) { detail in
                #if os(iOS)
                XgentIOSNode(node: detail, document: document, model: model)
                #else
                XgentNodeView(node: detail, document: document, model: model)
                #endif
            }
        }
        .modifier(XgentControlTypography(node: node))
        .padding(CGFloat(theme.spacing.md))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: theme.palette(for: scheme).surface),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .accessibilityElement(children: .contain)
    }
}
