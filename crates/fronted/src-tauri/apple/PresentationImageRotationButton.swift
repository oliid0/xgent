import SwiftUI

struct XgentImageRotationButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        XgentImageToolButton(label: node.label ?? "", icon: node.icon ?? "rotate.right", id: node.id,
                             disabled: node.disabled == true || node.action == nil) {
            guard let angle = XgentImageRotationDraft.angle(in: document, model: model) else { return }
            model.send(node, in: document, value: .number(XgentImageRotationDraft.normalized(angle + 90)), editing: true)
        }
    }
}
