import SwiftUI
import Flow

struct XgentSkillTags: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HFlow(alignment: .top, spacing: 6) {
            ForEach(node.children ?? []) { item in
                #if os(iOS)
                XgentIOSNode(node: item, document: document, model: model)
                #else
                XgentNodeView(node: item, document: document, model: model)
                #endif
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
