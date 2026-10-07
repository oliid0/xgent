import SwiftUI

struct XgentWorkspaceBulkAction: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var draft: XgentWorkspaceSourceDraft? {
        XgentWorkspaceSourceDraft.current(for: node, in: document, model: model)
    }
    private var available: Bool {
        node.id != "workspace-file-save-all" || node.current == 1 || draft?.dirty == true
    }

    var body: some View {
        Button {
            guard available else { return }
            Self.send(node, document: document, model: model)
        } label: {
            HStack(spacing: 6) {
                if model.isBusy(node, in: document), !node.id.hasPrefix("workspace-editor-bulk-cancel:") {
                    ProgressView().controlSize(.small).accessibilityHidden(true)
                }
                Text(node.label ?? "").modifier(XgentControlTypography(node: node))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(XgentActionButtonStyle(node: node))
        .disabled(node.disabled == true || model.isBusy(node, in: document) || !available)
        .accessibilityIdentifier(node.id)
    }

    @MainActor static func send(_ node: XgentNode, document: XgentDocument, model: XgentPresentationModel) {
        if !node.id.hasPrefix("workspace-editor-bulk-cancel:") { model.codeHosts.commit(in: document) }
        let draft = XgentWorkspaceSourceDraft.current(for: node, in: document, model: model)
        if node.id == "workspace-file-save-all" && node.current != 1 && draft?.dirty != true { return }
        let value: XgentValue = node.id.hasPrefix("workspace-editor-bulk-cancel:")
            ? .null : draft?.encoded.map(XgentValue.string) ?? .null
        model.send(node, in: document, value: value)
    }
}
