import SwiftUI

struct XgentMCPEditorFooter: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    @ViewBuilder private func action(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    var body: some View {
        Group {
            if textSize.isAccessibilitySize {
                VStack(alignment: .trailing, spacing: 12) {
                    ForEach(node.children ?? []) { action($0) }
                }
            } else {
                HStack(spacing: 12) {
                    Spacer(minLength: 0)
                    ForEach(node.children ?? []) { action($0) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.top, 16)
        .overlay(alignment: .top) { Divider() }
    }
}
