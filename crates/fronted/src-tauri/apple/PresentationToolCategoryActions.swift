import Flow
import SwiftUI

struct XgentToolCategoryActions: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HFlow(alignment: .top, spacing: 8) {
            ForEach(node.children ?? []) { action in
                XgentActionButton(node: action, document: document, model: model)
                    .accessibilityIdentifier(action.id)
                    .accessibilityLabel("\(node.label ?? "") \(action.label ?? "")")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
