import SwiftUI

// One native action per memory, with readable metadata instead of a repeated
// settings card/title/button. Large type keeps the review state below the title.
struct XgentMemoryEntry: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var review: String? { node.children?.first { $0.kind == .badge }?.label }

    var body: some View {
        Button { model.send(node, in: document) } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(node.label ?? "")
                        .font(XgentFonts.body(theme.fontFamily,
                            size: CGFloat(theme.typography.body * theme.fontScale), weight: .medium))
                        .foregroundStyle(Color(xgentHex: palette.text))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    if let text = node.text, !text.isEmpty {
                        Text(text)
                            .font(XgentFonts.body(theme.fontFamily,
                                size: CGFloat(theme.typography.supporting * theme.fontScale)))
                            .foregroundStyle(Color(xgentHex: palette.secondaryText))
                    }
                    if let review {
                        Label(review, systemImage: "circle.fill")
                            .font(.caption)
                            .foregroundStyle(Color.orange)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color(xgentHex: palette.secondaryText))
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(node.id)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color(xgentHex: palette.border)).frame(height: 0.5)
                .accessibilityHidden(true)
        }
    }
}
