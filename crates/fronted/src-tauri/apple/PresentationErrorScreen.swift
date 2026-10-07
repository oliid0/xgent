import SwiftUI

// Recovery uses the same commands as the other frontends. The page itself is
// native, including on iPhone; it never falls back to a web-rendered banner.
struct XgentErrorScreen: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme

    private var content: some View {
        VStack(spacing: CGFloat(theme.spacing.lg)) {
            ContentUnavailableView {
                Label(node.label ?? "", systemImage: node.icon ?? "exclamationmark.triangle")
            } description: {
                Text(node.text ?? "").fixedSize(horizontal: false, vertical: true)
            }
            .fixedSize(horizontal: false, vertical: true)
            #if os(iOS)
            XgentIOSNodes(nodes: node.children ?? [], document: document, model: model, parentAxis: .vertical)
            #else
            XgentNodeChildren(nodes: node.children ?? [], document: document, model: model)
            #endif
        }
        .frame(maxWidth: 640)
        .padding(CGFloat(theme.spacing.xl))
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("xgent-native-error-recovery")
    }

    @ViewBuilder var body: some View {
        #if os(macOS)
        if document.mode == .root {
            ScrollView { content }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            content
        }
        #else
        // iPhone root pages and sheets already own their vertical ScrollView.
        content
        #endif
    }
}
