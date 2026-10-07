import SwiftUI

// A model row contains an enable switch or a selection checkbox, token limits,
// and its actions. Compact windows and Dynamic Type move the secondary controls
// below the model name instead of squeezing the name between three columns.
struct XgentProviderModelRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var selection: XgentNode? { node.children?.first }
    private var limits: XgentNode? { node.children?.first { $0.id.hasPrefix("model-limits:") } }
    private var actions: XgentNode? { node.children?.first { $0.kind == .menu } }
    private var reorder: XgentNode? { node.children?.first { $0.id.hasPrefix("model-reorder:") } }

    @ViewBuilder private var modelControl: some View {
        if let selection {
            if selection.kind == .button {
                Button { model.send(selection, in: document) } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selection.selected == true ? "checkmark.square.fill" : "square")
                            .foregroundStyle(.tint).accessibilityHidden(true)
                        Text(selection.label ?? "").fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .modifier(XgentControlTypography(node: selection))
                .accessibilityIdentifier(selection.id)
                .accessibilityLabel(selection.label ?? "")
                .accessibilityAddTraits(selection.selected == true ? .isSelected : [])
                .disabled(selection.disabled == true || model.isBusy(selection, in: document))
            } else {
                XgentSwitch(node: selection, document: document, model: model)
                    .accessibilityIdentifier(selection.id)
            }
        }
    }

    @ViewBuilder private var limitsLabel: some View {
        if let limits {
            Text(limits.text ?? "")
                .modifier(XgentControlTypography(node: limits))
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(limits.id)
                .accessibilityLabel(limits.accessibilityLabel ?? limits.text ?? "")
        }
    }

    @ViewBuilder private var menu: some View {
        if let actions {
            XgentNativeMenu(node: actions, document: document, model: model)
                .accessibilityIdentifier(actions.id)
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            if let reorder {
                XgentNativeMenu(node: reorder, document: document, model: model)
                    .accessibilityIdentifier(reorder.id).fixedSize()
            }
            VStack(alignment: .leading, spacing: 4) {
                modelControl.lineLimit(1).truncationMode(.tail)
                limitsLabel.lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            menu.fixedSize()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
