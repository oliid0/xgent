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

    @ViewBuilder private var control: some View {
        if node.action != nil {
            Button { model.send(node, in: document) } label: { row }
                .buttonStyle(.plain)
                .disabled(node.disabled == true || model.isBusy(node, in: document))
        } else { row.accessibilityElement(children: .ignore) }
    }

    private var label: String { node.accessibilityLabel ?? node.label ?? "" }
    private var value: String { node.accessibilityValue ?? node.value?.text ?? "" }
    private var hint: String { node.accessibilityHint ?? node.text ?? "" }

    var body: some View {
        control
        .foregroundStyle(.primary)
        .modifier(XgentControlTypography(node: node))
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(value))
        .accessibilityHint(Text(hint))
    }
}
