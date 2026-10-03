import SwiftUI

struct XgentSkillStoreGrid: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    private var columns: [GridItem] {
        document.formFactor == .mobile || textSize.isAccessibilitySize
            ? [GridItem(.flexible())] : [GridItem(.adaptive(minimum: 260), alignment: .top)]
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
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
