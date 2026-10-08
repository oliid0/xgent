import SwiftUI

struct XgentQuestionHeader: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    private var prompt: XgentNode? { node.children?.first { $0.kind == .text } }
    private var controls: [XgentNode] { node.children?.first { $0.kind == .hStack }?.children ?? [] }

    @ViewBuilder private var promptText: some View {
        if let prompt {
            Text(prompt.text ?? "")
                .modifier(XgentControlTypography(node: prompt))
                .fontWeight(.medium)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var navigation: some View {
        HStack(spacing: 0) {
            ForEach(controls) { control in
                if control.kind == .button {
                    Button { model.send(control, in: document) } label: {
                        Group {
                            if model.isBusy(control, in: document) { ProgressView().controlSize(.small) }
                            else { Image(systemName: control.icon ?? "chevron.right") }
                        }.frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(control.disabled == true || model.isBusy(control, in: document))
                    .accessibilityLabel(control.label ?? "")
                    .accessibilityIdentifier(control.id)
                    .help(control.label ?? "")
                } else {
                    Text(control.text ?? "")
                        .modifier(XgentControlTypography(node: control))
                        .foregroundStyle(.secondary).monospacedDigit()
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
        }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 4) {
            promptText
            navigation.frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    var body: some View {
        if textSize.isAccessibilitySize { vertical }
        else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 8) { promptText; navigation }
                vertical
            }
        }
    }
}
