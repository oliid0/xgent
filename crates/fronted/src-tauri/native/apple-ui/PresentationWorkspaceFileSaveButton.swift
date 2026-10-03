import SwiftUI

struct XgentWorkspaceFileSaveButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var draft: XgentDocumentAnnotationDraft? {
        XgentDocumentAnnotationDraft.current(in: document, model: model)
    }

    var body: some View {
        Button {
            let value: XgentValue = draft?.encoded.map(XgentValue.string) ?? .null
            model.send(node, in: document, value: value)
        } label: {
            HStack(spacing: 6) {
                if let icon = node.icon { Image(systemName: icon).accessibilityHidden(true) }
                Text(node.label ?? "").modifier(XgentControlTypography(node: node))
            }
        }
        .buttonStyle(XgentActionButtonStyle(node: node))
        .disabled(node.disabled == true || model.isBusy(node, in: document) || (draft != nil && draft?.canSave != true))
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.label ?? "")
    }
}
