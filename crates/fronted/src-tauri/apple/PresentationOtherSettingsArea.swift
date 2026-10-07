import SwiftUI

// Other settings exposes the three actual lists in place, just as the shared
// desktop/mobile page does. A detail editor replaces these sections together.
struct XgentOtherSettingsArea: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(node.label ?? "")
                .font(.title3.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("\(node.id):heading")
            #if os(iOS)
            XgentIOSNodes(nodes: node.children ?? [], document: document, model: model)
            #else
            ForEach(node.children ?? []) { child in
                XgentNodeView(node: child, document: document, model: model)
            }
            #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(node.id)
    }
}
