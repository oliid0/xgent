import SwiftUI

struct XgentSkillPreview: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Spacer(minLength: 0)
                if let close = node.children?.first { content(close) }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(Array((node.children ?? []).dropFirst())) { content($0) }
                }.padding(.horizontal, 2).padding(.bottom, 16)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
