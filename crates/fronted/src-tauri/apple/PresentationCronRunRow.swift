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
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(summary.label ?? "").fixedSize(horizontal: false, vertical: true)
                            Text(summary.text ?? "").foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                        Text(summary.value?.text ?? "")
                            .foregroundStyle(node.status == "error" ? Color(xgentHex: theme.palette(for: scheme).error ?? "#E3193B") : Color.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Image(systemName: summary.selected == true ? "chevron.down" : "chevron.right").accessibilityHidden(true)
                    }
                    .frame(minHeight: 70, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(summary.disabled == true || model.isBusy(summary, in: document))
                .accessibilityIdentifier(summary.id)
                .accessibilityAddTraits(summary.selected == true ? .isSelected : [])
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
        .padding(.horizontal, CGFloat(theme.spacing.lg))
        .padding(.bottom, details.isEmpty ? 0 : CGFloat(theme.spacing.md))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

struct XgentCronRunList: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array((node.children ?? []).enumerated()), id: \.element.id) { index, item in
                if index > 0 { Divider().padding(.horizontal, CGFloat(theme.spacing.lg)) }
                XgentCronRunRow(node: item, document: document, model: model)
            }
        }
        .background(Color(xgentHex: theme.palette(for: scheme).muted),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.container)))
        .accessibilityElement(children: .contain)
    }
}
