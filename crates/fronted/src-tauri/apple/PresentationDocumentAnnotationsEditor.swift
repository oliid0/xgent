import SwiftUI

struct XgentDocumentAnnotationsEditor: View {
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
        VStack(alignment: .leading, spacing: 12) {
            ForEach(node.children ?? []) { item in
                if item.kind == .numberInput {
                    content(item).frame(maxWidth: 360, alignment: .leading)
                } else { content(item) }
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .environment(\.xgentSettingsRow, false)
        .accessibilityElement(children: .contain)
    }
}
