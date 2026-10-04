import SwiftUI

struct XgentSettingsNavigationRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var row: some View {
        XgentSettingsValueRow(node: node) {
            HStack(spacing: 8) {
                if let value = node.value?.text, !value.isEmpty {
                    Text(value).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if node.action != nil {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary).accessibilityHidden(true)
                }
            }
        }
        .contentShape(Rectangle())
    }

    var body: some View {
        Group {
            if node.action != nil {
                Button { model.send(node, in: document) } label: { row }
                    .buttonStyle(.plain)
                    .disabled(node.disabled == true || model.isBusy(node, in: document))
            } else { row.accessibilityElement(children: .ignore) }
        }
        .foregroundStyle(.primary)
        .modifier(XgentControlTypography(node: node))
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        .accessibilityValue(node.accessibilityValue ?? node.value?.text ?? "")
        .accessibilityHint(node.accessibilityHint ?? node.text ?? "")
    }
}
