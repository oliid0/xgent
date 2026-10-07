import SwiftUI

struct XgentWorkspaceImagePreview: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var zoom: CGFloat = 1
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(spacing: 0) {
            XgentWorkspaceImageToolbar(node: node, document: document, model: model, zoom: $zoom)
            Divider()
            XgentWorkspaceImageCanvas(encoded: node.value?.text ?? "", label: node.label ?? "",
                                      rotation: XgentImageRotationDraft.relative(in: document, model: model) ?? 0, zoom: $zoom)
        }
        .background(Color(xgentHex: theme.palette(for: scheme).muted).opacity(0.25))
        .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
    }
}
