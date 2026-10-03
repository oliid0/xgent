import SwiftUI

// Address controls stay editable while the JSON fields are collapsed. Wide
// desktop forms show the two JSON editors side by side like the shared form.
struct XgentHTTPRequestFields: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    private var nodes: [XgentNode] { node.children ?? [] }

    @ViewBuilder private func field(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(nodes) { field($0) }
        }
    }

    var body: some View {
        if document.formFactor == .mobile || textSize.isAccessibilitySize {
            vertical
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(nodes) { field($0).frame(minWidth: 220, maxWidth: .infinity) }
                }
                vertical
            }
        }
    }
}
