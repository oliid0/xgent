import Flow
import SwiftUI

struct XgentHorizontalControls<Content: View>: View {
    let node: XgentNode
    let content: Content
    @Environment(\.xgentPresentationTheme) private var theme

    init(node: XgentNode, @ViewBuilder content: () -> Content) {
        self.node = node
        self.content = content()
    }

    var body: some View {
        if node.wrap == true {
            HFlow(itemSpacing: CGFloat(node.spacing ?? theme.spacing.sm), rowSpacing: CGFloat(theme.spacing.sm)) {
                content
            }
        } else {
            HStack(spacing: node.spacing.map { CGFloat($0) }) { content }
        }
    }
}

struct XgentSlider: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var value: Binding<Double> {
        Binding(get: {
            if case .number(let value) = model.value(node, in: document) { return value }
            return node.minimum ?? 0
        }, set: { model.send(node, in: document, value: .number($0), editing: true) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    XgentFieldLabel(node: node)
                    Spacer(minLength: 8)
                    Text(value.wrappedValue.formatted()).foregroundStyle(.secondary).monospacedDigit()
                }
                VStack(alignment: .leading, spacing: 4) {
                    XgentFieldLabel(node: node)
                    Text(value.wrappedValue.formatted()).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            Slider(value: value, in: (node.minimum ?? 0)...(node.maximum ?? 1), step: node.step ?? 0.1)
                .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        }
        .modifier(XgentControlTypography(node: node))
        .disabled(node.disabled == true)
    }
}
