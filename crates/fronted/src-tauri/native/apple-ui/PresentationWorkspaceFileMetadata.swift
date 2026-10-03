import Flow
import SwiftUI

struct XgentWorkspaceFileMetadata: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HFlow(itemSpacing: 8, rowSpacing: 6) {
            #if os(iOS)
            XgentIOSNodes(nodes: node.children ?? [], document: document, model: model)
            #else
            XgentNodeChildren(nodes: node.children ?? [], document: document, model: model)
            #endif
        }
        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
