import SwiftUI

struct XgentComputerUsePermissionRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var status: XgentNode? { node.children?.first { $0.kind == .badge } }
    private var request: XgentNode? { node.children?.first { $0.kind == .button } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            XgentSettingsValueRow(node: node) {
                if let status {
                    Label(status.label ?? "", systemImage: status.status == "completed" ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(status.status == "completed" ? Color.green : Color.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier(status.id)
                }
            }
            if let request {
                XgentActionButton(node: request, document: document, model: model)
                    .accessibilityIdentifier(request.id)
            }
        }
        .modifier(XgentControlTypography(node: node))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
