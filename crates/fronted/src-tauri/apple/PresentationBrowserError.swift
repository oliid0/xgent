import SwiftUI

struct XgentBrowserError: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(node.children ?? []) { item in
                #if os(iOS)
                XgentIOSNode(node: item, document: document, model: model)
                    .frame(maxWidth: item.kind == .banner ? .infinity : nil, alignment: .leading)
                #else
                XgentNodeView(node: item, document: document, model: model)
                    .frame(maxWidth: item.kind == .banner ? .infinity : nil, alignment: .leading)
                #endif
            }
        }.padding(8)
    }
}
