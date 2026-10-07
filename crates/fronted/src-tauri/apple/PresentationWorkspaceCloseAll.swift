import SwiftUI

struct XgentWorkspaceCloseAll: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var presented = false

    var body: some View {
        Color.clear.frame(height: 0)
            .onAppear { presented = true }
            .sheet(isPresented: $presented, onDismiss: {
                guard let cancel = node.children?.first(where: { $0.id.hasPrefix("workspace-editor-bulk-cancel:") }) else { return }
                model.send(cancel, in: document)
            }) {
                XgentWorkspaceCloseAllContent(node: node, document: document, model: model)
                    #if os(iOS)
                    .presentationDetents([.medium, .large])
                    #else
                    .frame(minWidth: 320, idealWidth: 560, minHeight: 280, idealHeight: 440)
                    #endif
            }
    }
}
