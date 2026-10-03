import SwiftUI

struct XgentMCPImportRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(node.label ?? "")
                .modifier(XgentControlTypography(node: node)).fontWeight(.medium)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("\(node.id):name")
            ForEach(node.children ?? []) { content($0) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Divider() }
        .environment(\.xgentSettingsRow, false)
        .accessibilityElement(children: .contain)
    }
}
