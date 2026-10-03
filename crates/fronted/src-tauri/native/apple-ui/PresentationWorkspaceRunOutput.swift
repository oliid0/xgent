import SwiftUI

struct XgentWorkspaceRunOutput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var presented = false

    var body: some View {
        Color.clear.frame(height: 0)
            .onAppear { presented = true }
            .sheet(isPresented: $presented, onDismiss: {
                guard node.current != 1, let dismiss = document.node(id: "workspace-file-run-dismiss") else { return }
                model.send(dismiss, in: document)
            }) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(node.label ?? "").font(.headline).accessibilityAddTraits(.isHeader)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach((node.children ?? []).filter { $0.id != "workspace-file-run-dismiss" }) { item in
                                #if os(iOS)
                                XgentIOSNode(node: item, document: document, model: model)
                                #else
                                XgentNodeView(node: item, document: document, model: model)
                                #endif
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
                .interactiveDismissDisabled(node.current == 1)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #else
                .frame(minWidth: 320, idealWidth: 640, minHeight: 360)
                #endif
            }
    }
}
