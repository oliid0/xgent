import SwiftUI

struct XgentWorkspaceFileOpenMenu: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        Menu {
            XgentWorkspaceFileMenuContent(node: node, document: document, model: model)
        } label: {
            XgentWorkspaceFileMenuLabel(node: node, busy: model.isBusy(node, in: document))
        }
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.label ?? "")
        #if os(macOS)
        .task(id: "\(document.surface)\u{0}\(node.text ?? "")") {
            guard node.options?.contains(where: { $0.value == "$refresh" && $0.disabled != true }) == true else { return }
            model.send(node, in: document, value: .string("$refresh"))
        }
        #endif
    }
}
