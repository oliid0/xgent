import SwiftUI

// The editor's final actions remain outside its scrolling details on both
// Apple form factors. Each actual button owns its full equal-width label.
struct XgentProviderEditorFooter: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HStack(spacing: CGFloat(node.spacing ?? 8)) {
            ForEach(node.children ?? []) { action in
                XgentActionButton(node: action, document: document, model: model)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background { XgentThemeBackground() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(node.id)
    }
}
