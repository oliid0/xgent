import SwiftUI

struct XgentWorkspaceEditorTab: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    private var dirty: Bool {
        node.current == 1 || (node.selected == true &&
            XgentWorkspaceSourceDraft.current(for: node, in: document, model: model)?.dirty == true)
    }

    var body: some View {
        HStack(spacing: 0) {
            if let select = node.children?.first {
                XgentWorkspaceTabAction(node: select, document: document, model: model,
                                        selected: node.selected == true, dirty: dirty)
                    .accessibilityHint(node.text ?? "")
            }
            if let close = node.children?.last, close.id != node.children?.first?.id {
                XgentWorkspaceTabAction(node: close, document: document, model: model, closing: true)
            }
        }
        .background(node.selected == true ? Color(xgentHex: theme.palette(for: scheme).muted) : .clear,
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner)))
        .overlay(alignment: .bottom) {
            if node.selected == true { Rectangle().fill(Color(xgentHex: theme.palette(for: scheme).accent)).frame(height: 2) }
        }
        .accessibilityElement(children: .contain)
        #if os(macOS)
        .help(node.text ?? node.label ?? "")
        #endif
    }
}
