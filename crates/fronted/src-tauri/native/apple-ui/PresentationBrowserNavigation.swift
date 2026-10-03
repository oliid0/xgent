import SwiftUI
import Flow

struct XgentBrowserNavigation: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var fields: [XgentNode] { node.children ?? [] }
    private var entry: XgentNode? { fields.first { $0.variant == "browser-address-entry" } }
    private var vertical: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let entry { content(entry) }
            HFlow(alignment: .center, spacing: 6) {
                ForEach(fields.filter { $0.variant != "browser-address-entry" }) { content($0) }
            }
        }
    }

    var body: some View {
        Group {
            if textSize.isAccessibilitySize { vertical }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) {
                        ForEach(fields) { item in
                            if item.variant == "browser-address-entry" { content(item).frame(minWidth: 160) }
                            else { content(item) }
                        }
                    }
                    vertical
                }
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
