import SwiftUI

struct XgentCodeBlockHeader: View {
    let title: String
    let text: String
    let canCollapse: Bool
    let lineCount: Int
    let labels: XgentCodeBlockConfiguration.Labels
    @Binding var collapsed: Bool
    var foreground: String? = nil
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .caption) private var fontSize: CGFloat = 13

    private var toggleLabel: String {
        collapsed ? labels.expand.replacingOccurrences(of: "{count}", with: String(lineCount)) : labels.collapse
    }

    private var controlSize: CGFloat {
        #if os(iOS)
        return max(44, CGFloat(theme.control.small))
        #else
        return CGFloat(theme.control.small)
        #endif
    }

    private var titleLabel: some View {
        HStack(spacing: 4) {
            if canCollapse {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .rotationEffect(.degrees(collapsed ? 0 : 90))
                    .accessibilityHidden(true)
            }
            Text(title).lineLimit(1).truncationMode(.middle)
        }
        .font(XgentFonts.code(theme.codeFontFamily, size: fontSize * CGFloat(theme.fontScale)))
        .foregroundStyle(Color(xgentHex: foreground ?? theme.palette(for: scheme).secondaryText))
        .frame(minHeight: controlSize)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    var body: some View {
        HStack(spacing: 8) {
            if canCollapse {
                Button { collapsed.toggle() } label: { titleLabel }
                    .buttonStyle(.plain)
                    .help(toggleLabel)
                    .accessibilityLabel(title)
                    .accessibilityValue(collapsed ? labels.collapsedState ?? "Collapsed" : labels.expandedState ?? "Expanded")
                    .accessibilityHint(toggleLabel)
                    .accessibilityIdentifier("xgent-code-disclosure")
            } else { titleLabel }
            XgentCodeBlockCopy(text: text, labels: labels)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }
}
