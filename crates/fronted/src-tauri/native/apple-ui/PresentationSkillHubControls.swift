import SwiftUI
import Flow

struct XgentSkillHubControls: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    @ViewBuilder private func control(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var fields: [XgentNode] { node.children ?? [] }
    private var vertical: some View {
        VStack(alignment: .leading, spacing: 12) { ForEach(fields) { control($0) } }
    }

    var body: some View {
        Group {
            if node.variant == "skill-bulk-actions" {
                HFlow(alignment: .top, spacing: 8) { ForEach(fields) { control($0) } }
                    .padding(.vertical, 12)
                    .overlay(alignment: .top) { Divider() }
            } else if document.formFactor == "mobile" || textSize.isAccessibilitySize { vertical }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(fields) { control($0).frame(minWidth: 180, maxWidth: .infinity) }
                    }
                    vertical
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
