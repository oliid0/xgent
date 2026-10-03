import SwiftUI

struct XgentTaskProgressPopover: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(node.accessibilityLabel ?? node.label ?? "")
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text(node.text ?? "").monospacedDigit().foregroundStyle(.secondary)
            }.modifier(XgentControlTypography(node: node))
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(node.children ?? []) { task in
                        XgentTaskProgressStep(node: task)
                    }
                }.padding(.vertical, 4)
            }
            .frame(maxHeight: document.formFactor == "mobile" ? 320 : 384)
        }
        .padding(CGFloat(theme.spacing.lg))
        .frame(minWidth: 0, idealWidth: document.formFactor == "mobile" ? 260 : 360,
               maxWidth: document.formFactor == "mobile" ? 280 : 480, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
