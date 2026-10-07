import SwiftUI

struct XgentSkillImportRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(node.label ?? "").modifier(XgentControlTypography(node: node)).fontWeight(.semibold)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(node.children ?? []) { item in
                if item.kind == .toggle {
                    HStack {
                        Text(item.label ?? "").modifier(XgentControlTypography(node: item))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        XgentSkillSelection(node: item, document: document, model: model, checkbox: true)
                    }
                } else {
                    #if os(iOS)
                    XgentIOSNode(node: item, document: document, model: model)
                    #else
                    XgentNodeView(node: item, document: document, model: model)
                    #endif
                }
            }
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .contain)
    }
}
