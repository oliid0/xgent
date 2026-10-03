import SwiftUI

// A policy keeps the human name, exact tool identifier and description together.
// The selector remains one real shared policy action on both Apple platforms.
struct XgentToolPolicyRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .caption) private var identifierScale = 1.0

    private var selector: XgentNode? { node.children?.first { $0.kind == .selector } }
    private var detail: XgentNode? { node.children?.first { $0.kind == .text } }

    private var description: some View {
        VStack(alignment: .leading, spacing: 6) {
            XgentFieldLabel(node: node)
            Text(node.text ?? "")
                .font(XgentFonts.code(theme.codeFontFamily,
                    size: CGFloat(theme.typography.caption * theme.fontScale) * identifierScale))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if let detail {
                Text(detail.text ?? "")
                    .modifier(XgentControlTypography(node: detail))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var control: some View {
        if let selector {
            XgentSelector(node: selector, document: document, model: model, showsLabel: false)
                .accessibilityIdentifier(selector.id)
                .environment(\.xgentSettingsRow, false)
        }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 12) { description; control }
    }

    var body: some View {
        Group {
            if document.formFactor == "mobile" || textSize.isAccessibilitySize { vertical }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 20) {
                        description.frame(minWidth: 240)
                        control.frame(width: 148)
                    }
                    vertical
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
    }
}
