import SwiftUI

struct XgentSkillRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach((node.children ?? []).filter { $0.variant != "skill-row-actions" }) { content($0) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var actions: some View {
        if let action = node.children?.first(where: { $0.variant == "skill-row-actions" }) { content(action) }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 12) { summary; actions }
    }

    var body: some View {
        Group {
            if node.variant == "skill-store-card" || document.formFactor == "mobile" || textSize.isAccessibilitySize { vertical }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 20) {
                        Image(systemName: node.icon ?? "puzzlepiece.extension")
                            .foregroundStyle(.secondary).accessibilityHidden(true)
                        summary.frame(minWidth: 240)
                        actions
                    }
                    vertical
                }
            }
        }
        .padding(16)
        .background(Color(xgentHex: theme.palette(for: scheme).card),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.container)))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.container))
                .stroke(Color(xgentHex: theme.palette(for: scheme).border), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }
}
