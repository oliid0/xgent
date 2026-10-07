import SwiftUI

struct XgentBrowserHeader: View {
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
        Group {
            if !model.windowChromeInstalled {
                HStack(alignment: .center, spacing: 12) {
                    if let heading = node.children?.first { content(heading).frame(maxWidth: .infinity, alignment: .leading) }
                    ForEach(Array((node.children ?? []).dropFirst())) { content($0) }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
