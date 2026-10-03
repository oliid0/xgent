import SwiftUI

struct XgentWorkspaceFileMenuContent: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        ForEach(node.options ?? []) { option in
            if option.value == "open", node.options?.contains(where: { $0.value.hasPrefix("app:") || $0.value == "$loading" }) == true {
                Divider()
            }
            if option.value == "reveal" { Divider() }
            Button(option.label) { model.send(node, in: document, value: .string(option.value)) }
                .disabled(option.disabled == true || node.disabled == true)
                .accessibilityIdentifier("\(node.id).\(option.value)")
        }
    }
}
