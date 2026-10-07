import SwiftUI

struct XgentTerminalConnectionFields: View {
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

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(node.children ?? []) { content($0).frame(maxWidth: .infinity) }
        }
    }

    var body: some View {
        Group {
            if textSize.isAccessibilitySize { vertical }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 12) {
                        ForEach(node.children ?? []) { item in
                            if item.variant == "terminal-session-tabs" { content(item).frame(minWidth: 120) }
                            else { content(item).frame(minWidth: 160, maxWidth: 240) }
                        }
                    }
                    vertical
                }
            }
        }
        .environment(\.xgentSettingsRow, false)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
