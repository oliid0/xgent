import SwiftUI
import Flow

struct XgentSkillRowActions: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HFlow(alignment: .top, spacing: 8) {
            ForEach(node.children ?? []) { item in
                if item.kind == .toggle {
                    XgentSkillSelection(node: item, document: document, model: model,
                        checkbox: item.id.hasSuffix(":bulk"))
                } else {
                    #if os(iOS)
                    XgentIOSNode(node: item, document: document, model: model)
                    #else
                    XgentNodeView(node: item, document: document, model: model)
                    #endif
                }
            }
        }
    }
}
