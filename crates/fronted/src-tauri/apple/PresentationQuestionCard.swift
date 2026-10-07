import SwiftUI

struct XgentQuestionCard: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: CGFloat(theme.spacing.md)) {
            ForEach(node.children ?? []) { item in
                if item.kind == .segmentedControl {
                    XgentQuestionTabs(node: item, document: document, model: model)
                } else {
                    #if os(iOS)
                    XgentIOSNode(node: item, document: document, model: model)
                    #else
                    XgentNodeView(node: item, document: document, model: model)
                    #endif
                }
            }
        }
        .padding(CGFloat(theme.spacing.lg))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: theme.palette(for: scheme).card),
            in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element))
                .stroke(Color(xgentHex: theme.palette(for: scheme).border), lineWidth: 1)
        }
        .environment(\.xgentSettingsRow, false)
        .accessibilityElement(children: .contain)
    }
}
