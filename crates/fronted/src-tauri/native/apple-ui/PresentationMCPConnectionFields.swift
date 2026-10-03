import SwiftUI

// Name, transport and timeout form one row on desktop. Narrow windows and
// accessibility text use the same field order without squeezing controls.
struct XgentMCPConnectionFields: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    @ViewBuilder private func field(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(node.children ?? []) { field($0) }
        }
    }

    var body: some View {
        if document.formFactor == "mobile" || textSize.isAccessibilitySize { vertical }
        else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(node.children ?? []) {
                        field($0).frame(minWidth: 180, maxWidth: .infinity)
                    }
                }
                vertical
            }
        }
    }
}
