import SwiftUI

struct XgentCronDetailLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    @ViewBuilder private func pane(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(node.children ?? []) { pane($0) }
        }
    }

    var body: some View {
        if document.formFactor == .mobile || textSize.isAccessibilitySize { stacked }
        else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 20) {
                    ForEach(node.children ?? []) { pane($0).frame(minWidth: 340, maxWidth: .infinity) }
                }
                stacked
            }
        }
    }
}

struct XgentCronDetailSection: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme

    private var header: [XgentNode] { (node.children ?? []).filter { $0.kind == .badge || $0.kind == .iconButton } }
    private var content: [XgentNode] { (node.children ?? []).filter { $0.kind != .badge && $0.kind != .iconButton } }
    @ViewBuilder private func render(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: CGFloat(theme.spacing.sm)) {
            if let label = node.label, !label.isEmpty {
                Text(label).font(.headline).accessibilityAddTraits(.isHeader)
            }
            if !header.isEmpty {
                HStack(spacing: 8) {
                    ForEach(header.filter { $0.kind == .badge }) { render($0) }
                    Spacer(minLength: 0)
                    ForEach(header.filter { $0.kind == .iconButton }) { render($0) }
                }
            }
            ForEach(Array(content.enumerated()), id: \.element.id) { index, item in
                if index > 0 && item.variant == "cron-detail-value" { Divider() }
                render(item)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
