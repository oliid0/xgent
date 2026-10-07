import SwiftUI

struct XgentWorkspaceSourceAction: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var draft: XgentWorkspaceSourceDraft? {
        XgentWorkspaceSourceDraft.current(for: node, in: document, model: model)
    }
    private var available: Bool {
        guard let draft, draft.encoded != nil else { return false }
        return node.id != "workspace-file-save" || draft.dirty
    }

    var body: some View {
        Button {
            model.codeHosts.commit(in: document)
            guard available, let value = draft?.encoded else { return }
            model.send(node, in: document, value: .string(value))
        } label: {
            HStack(spacing: 6) {
                if let icon = node.icon { Image(systemName: icon).accessibilityHidden(true) }
                Text(node.label ?? "").modifier(XgentControlTypography(node: node))
            }
        }
        .buttonStyle(XgentActionButtonStyle(node: node))
        .disabled(node.disabled == true || model.isBusy(node, in: document) || !available)
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.label ?? "")
    }
}
