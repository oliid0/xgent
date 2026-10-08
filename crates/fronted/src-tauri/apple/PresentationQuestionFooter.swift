import SwiftUI

struct XgentQuestionFooter: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    private var status: XgentNode? { node.children?.first { $0.kind == .text } }
    private var actions: [XgentNode] { node.children?.filter { $0.kind == .button } ?? [] }

    @ViewBuilder private var statusText: some View {
        if let status {
            Text(status.text ?? "")
                .modifier(XgentControlTypography(node: status))
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var button: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                ForEach(actions) { action in
                    XgentActionButton(node: action, document: document, model: model)
                }
            }.fixedSize(horizontal: true, vertical: false)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(actions) { action in
                    XgentActionButton(node: action, document: document, model: model)
                }
            }
        }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 10) { statusText; button }
    }

    var body: some View {
        if textSize.isAccessibilitySize { vertical }
        else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    statusText.fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 8)
                    button.fixedSize(horizontal: true, vertical: false)
                }
                vertical
            }
        }
    }
}
