import Flow
import SwiftUI

struct XgentTerminalToolbar: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HFlow(itemSpacing: CGFloat(node.spacing ?? 12), rowSpacing: 8) {
            #if os(iOS)
            XgentIOSNodes(nodes: node.children ?? [], document: document, model: model)
            #else
            XgentNodeChildren(nodes: node.children ?? [], document: document, model: model)
            #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(node.label ?? document.title)
    }
}

extension XgentNodeView {
    var nativeTerminalToolbar: some View { XgentTerminalToolbar(node: node, document: document, model: model) }
}
