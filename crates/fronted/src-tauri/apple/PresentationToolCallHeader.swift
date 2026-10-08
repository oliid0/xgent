import SwiftUI

// Work evidence is a readable transcript item. Reserve monospaced text for the
// command or diff below, rather than compressing the activity title to one line.
struct XgentToolCallHeader: View {
    let node: XgentNode
    var statusOverride: String? = nil
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var bodyScale = 1.0
    @ScaledMetric(relativeTo: .caption) private var detailScale = 1.0

    @ViewBuilder private var status: some View {
        switch statusOverride ?? node.status {
        case "completed": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case "error": Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
        case "running": ProgressView().controlSize(.small)
        case "paused": Image(systemName: "pause.circle").foregroundStyle(.secondary)
        default: Image(systemName: "circle").foregroundStyle(.secondary)
        }
    }

    var body: some View {
        let palette = theme.palette(for: colorScheme)
        HStack(alignment: .top, spacing: 8) {
            status.frame(minWidth: 20).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(node.label ?? "Tool")
                    .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.body * theme.fontScale) * bodyScale))
                    .foregroundStyle(Color(xgentHex: node.variant == "timeline" ? palette.secondaryText : palette.text))
                    .fixedSize(horizontal: false, vertical: true)
                if let text = node.text, !text.isEmpty {
                    Text(text)
                        .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale))
                        .foregroundStyle(Color(xgentHex: palette.secondaryText))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(statusOverride ?? node.accessibilityValue ?? node.status ?? "")
    }
}
