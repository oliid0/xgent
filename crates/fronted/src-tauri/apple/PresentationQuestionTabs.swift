import Flow
import SwiftUI

// Wrapping tabs retain long question headers at large text sizes; a segmented
// system picker would truncate those headers on a narrow phone.
struct XgentQuestionTabs: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let palette = theme.palette(for: scheme)
        HFlow(alignment: .top, spacing: 8) {
            ForEach(node.options ?? []) { option in
                let selected = model.value(node, in: document).text == option.value
                Button { model.send(node, in: document, value: .string(option.value), editing: true) } label: {
                    Text(option.label)
                        .modifier(XgentControlTypography(node: node))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .frame(minHeight: 44)
                        .background(Color(xgentHex: selected ? palette.muted : palette.surface),
                            in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner)))
                }
                .buttonStyle(.plain)
                .disabled(node.disabled == true || option.disabled == true)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("\(node.id):\(option.value)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(node.label ?? "")
    }
}
