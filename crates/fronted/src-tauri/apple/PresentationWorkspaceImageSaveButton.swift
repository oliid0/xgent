import SwiftUI

struct XgentWorkspaceImageSaveButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        Button {
            guard let angle = XgentImageRotationDraft.angle(in: document, model: model) else { return }
            model.send(node, in: document, value: .number(angle))
        } label: {
            HStack(spacing: 6) {
                if model.isBusy(node, in: document) { ProgressView().controlSize(.small) }
                else if let icon = node.icon { Image(systemName: icon).accessibilityHidden(true) }
                Text(node.label ?? "").modifier(XgentControlTypography(node: node))
            }
        }
        .buttonStyle(XgentActionButtonStyle(node: node))
        .disabled(node.disabled == true || model.isBusy(node, in: document) ||
                  (XgentImageRotationDraft.relative(in: document, model: model) ?? 0) == 0)
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.label ?? "")
    }
}
