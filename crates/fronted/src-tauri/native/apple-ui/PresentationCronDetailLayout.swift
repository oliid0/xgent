import SwiftUI

struct XgentCronDetailLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    @ViewBuilder private func pane(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(node.children ?? []) { pane($0) }
        }
    }

    var body: some View {
        if document.formFactor == "mobile" || textSize.isAccessibilitySize { stacked }
        else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 20) {
                    ForEach(node.children ?? []) { pane($0).frame(minWidth: 340, maxWidth: .infinity) }
                }
                stacked
            }
        }
    }
}
