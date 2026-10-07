import SwiftUI
import Flow

struct XgentSkillsHubToolbar: View {
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

    private var title: some View {
        HStack(spacing: 12) {
            ForEach((node.children ?? []).filter { $0.kind == .iconButton || $0.kind == .heading }) { content($0) }
        }
    }

    private var actions: some View {
        HFlow(alignment: .top, spacing: 12) {
            ForEach((node.children ?? []).filter { $0.kind != .iconButton && $0.kind != .heading }) { content($0) }
        }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 12) { title; actions }
    }

    var body: some View {
        if textSize.isAccessibilitySize { vertical }
        else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 24) { title; Spacer(minLength: 8); actions }
                vertical
            }
        }
    }
}
