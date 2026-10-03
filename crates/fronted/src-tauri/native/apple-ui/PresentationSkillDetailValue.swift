import SwiftUI

struct XgentSkillDetailValue: View {
    let node: XgentNode

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(node.label ?? "").modifier(XgentControlTypography(node: node))
                .foregroundStyle(.secondary).fontWeight(.medium)
            Text(node.text ?? "").modifier(XgentControlTypography(node: node))
                .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
