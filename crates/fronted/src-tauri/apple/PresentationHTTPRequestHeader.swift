import SwiftUI

struct XgentHTTPRequestHeader: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        Button { model.send(node, in: document) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: node.selected == true ? "chevron.down" : "chevron.right")
                    .accessibilityHidden(true)
                Text(node.label ?? "").fixedSize(horizontal: false, vertical: true)
            }
            .modifier(XgentControlTypography(node: node))
            .frame(minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityLabel(node.label ?? "")
        .accessibilityValue(node.text ?? "")
        .accessibilityHint(node.accessibilityHint ?? "")
        .accessibilityIdentifier(node.id)
        .accessibilityAddTraits(node.selected == true ? [.isSelected] : [])
    }
}
