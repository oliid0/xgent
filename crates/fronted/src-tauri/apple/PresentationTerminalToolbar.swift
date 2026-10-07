import Flow
import SwiftUI

struct XgentTerminalToolbar: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        Group {
            if node.variant == "workspace-file-toolbar" {
                XgentWorkspaceFileToolbar(node: node, document: document, model: model)
            } else if node.variant == "terminal-connection-fields" {
                XgentTerminalConnectionFields(node: node, document: document, model: model)
            } else {
                controls
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(node.label ?? document.title)
    }

    private var controls: some View {
        HFlow(itemSpacing: CGFloat(node.spacing ?? 12), rowSpacing: 8) {
            #if os(iOS)
            XgentIOSNodes(nodes: node.children ?? [], document: document, model: model)
            #else
            XgentNodeChildren(nodes: node.children ?? [], document: document, model: model)
            #endif
        }
    }
}

extension XgentNodeView {
    var nativeTerminalToolbar: some View { XgentTerminalToolbar(node: node, document: document, model: model) }
}
