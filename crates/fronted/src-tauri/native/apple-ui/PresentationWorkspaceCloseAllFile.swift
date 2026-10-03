import SwiftUI

struct XgentWorkspaceCloseAllFile: View {
    let node: XgentNode

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: node.current == 1 ? "circle.fill" : "doc.text")
                .imageScale(.small).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(node.label ?? "").modifier(XgentControlTypography(node: node)).fontWeight(.semibold)
                Text(node.text ?? "").modifier(XgentControlTypography(node: node)).foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }.fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(node.accessibilityLabel ?? node.text ?? node.label ?? "")
        .accessibilityIdentifier(node.id)
    }
}
