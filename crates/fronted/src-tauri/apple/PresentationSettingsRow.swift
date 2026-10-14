import SwiftUI

private struct XgentSettingsRowKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var xgentSettingsRow: Bool {
        get { self[XgentSettingsRowKey.self] }
        set { self[XgentSettingsRowKey.self] = newValue }
    }
}

// A setting has one label and one value. Long translations and accessibility
// text move the value below its label, without shrinking either control.
struct XgentSettingsValueRow<Content: View>: View {
    let node: XgentNode
    let content: Content
    let showsDescription: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .subheadline) private var detailScale = 1.0
    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 22
    private var isConnector: Bool { node.variant?.hasPrefix("device-connector") == true }

    init(node: XgentNode, showsDescription: Bool = true, @ViewBuilder content: () -> Content) {
        self.node = node
        self.showsDescription = showsDescription
        self.content = content()
    }

    private var label: some View {
        HStack(alignment: isConnector ? .center : .firstTextBaseline, spacing: 10) {
            if let icon = node.icon {
                Image(systemName: icon)
                    .font(.system(size: iconSize, weight: .regular))
                    .foregroundStyle(isConnector ? connectorColor : Color.primary)
                    .frame(width: isConnector ? max(40, iconSize) : max(24, iconSize),
                           height: isConnector ? max(40, iconSize) : nil)
                    .background {
                        if isConnector {
                            RoundedRectangle(cornerRadius: 11)
                                .fill(Color(xgentHex: theme.palette(for: scheme).muted))
                        }
                    }
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                XgentFieldLabel(node: node)
                if showsDescription, let text = node.text, !text.isEmpty {
                    Text(text)
                        .font(XgentFonts.body(theme.fontFamily,
                            size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityHidden(true)
                }
            }
        }
    }

    private var connectorColor: Color {
        switch node.icon {
        case "heart.fill": return Color(xgentHex: scheme == .dark ? "#ff375f" : "#ff2d55")
        case "house.fill": return Color(xgentHex: scheme == .dark ? "#ff9f0a" : "#ff9500")
        default: return .accentColor
        }
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: 10) {
            label.fixedSize(horizontal: false, vertical: true)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        Group {
            #if os(macOS)
            XgentDesktopSettingsValueLayout(stacked: dynamicTypeSize.isAccessibilitySize) {
                VStack(alignment: .leading, spacing: 0) { label }
                VStack(alignment: .leading, spacing: 0) { content }
            }
            #else
            if dynamicTypeSize.isAccessibilitySize { stacked }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 12) {
                        label.fixedSize(horizontal: true, vertical: false)
                        Spacer(minLength: 12)
                        content.fixedSize(horizontal: true, vertical: false)
                    }
                    stacked
                }
            }
            #endif
        }
        .frame(maxWidth: .infinity, minHeight: isConnector ? 60 : 44, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
