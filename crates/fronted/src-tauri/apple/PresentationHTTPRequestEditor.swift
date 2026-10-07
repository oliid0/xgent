import SwiftUI

struct XgentHTTPRequestEditorRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    private var header: XgentNode? { node.children?.first { $0.kind == .button } }
    private var remove: XgentNode? { node.children?.first { $0.kind == .iconButton } }
    private var content: [XgentNode] { node.children?.filter { $0.kind == .vStack } ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                if let header { XgentHTTPRequestHeader(node: header, document: document, model: model) }
                Spacer(minLength: 0)
                if let remove { XgentIconButton(node: remove, document: document, model: model) }
            }
            ForEach(content) { item in
                #if os(iOS)
                XgentIOSNode(node: item, document: document, model: model)
                #else
                XgentNodeView(node: item, document: document, model: model)
                #endif
            }
        }
        .padding(CGFloat(theme.spacing.md))
        .background(Color(xgentHex: theme.palette(for: scheme).surface),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element))
                .stroke(Color(xgentHex: theme.palette(for: scheme).border))
                .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(node.label ?? "")
    }
}
