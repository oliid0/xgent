import Flow
import SwiftUI

struct XgentBackupTransferActions: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HFlow(itemSpacing: 8, rowSpacing: 10) {
            ForEach(node.children ?? []) { action in
                XgentActionButton(node: action, document: document, model: model)
                    .accessibilityIdentifier(action.id)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
