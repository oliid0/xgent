import SwiftUI

struct XgentMCPServerEditor: View {
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
            ForEach(node.children ?? []) { item in
                if item.kind == .scrollView {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            ForEach(item.children ?? []) { content($0) }
                        }
                        .padding(.vertical, 12)
                        .padding(.horizontal, 2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    #if os(iOS)
                    .scrollDismissesKeyboard(.interactively)
                    #endif
                } else { content(item) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(document.formFactor == .mobile ? 16 : 24)
        .environment(\.xgentSettingsRow, false)
    }
}
