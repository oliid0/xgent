import Flow
import SwiftUI

struct XgentWorkspaceCloseAllContent: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(node.label ?? "").modifier(XgentControlTypography(node: node))
                .fontWeight(.semibold).accessibilityAddTraits(.isHeader)
            Text(node.text ?? "").modifier(XgentControlTypography(node: node))
                .fixedSize(horizontal: false, vertical: true)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach((node.children ?? []).filter { $0.kind == .banner }) { error in
                        #if os(iOS)
                        XgentIOSNode(node: error, document: document, model: model)
                        #else
                        XgentNodeView(node: error, document: document, model: model)
                        #endif
                    }
                    ForEach((node.children ?? []).filter { $0.variant == "workspace-editor-close-file" }) { file in
                        XgentWorkspaceCloseAllFile(node: file)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: 0, maxHeight: .infinity)
            .layoutPriority(-1)
            HFlow(itemSpacing: 8, rowSpacing: 8) {
                ForEach((node.children ?? []).filter { $0.kind == .button }) { action in
                    if action.id.hasPrefix("workspace-editor-bulk-cancel:") {
                        XgentWorkspaceBulkAction(node: action, document: document, model: model)
                            .keyboardShortcut(.cancelAction)
                    } else if action.id.hasPrefix("workspace-editor-bulk-save:") {
                        XgentWorkspaceBulkAction(node: action, document: document, model: model)
                            .keyboardShortcut(.defaultAction)
                    } else {
                        XgentWorkspaceBulkAction(node: action, document: document, model: model)
                    }
                }
            }
        }
        .padding(16)
        .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityIdentifier(node.id)
    }
}
