import SwiftUI

// Geometry comes from the same serialized Astryx tokens as the other clients.
// A minimum hit target is separate from typography; labels may grow and wrap.
struct XgentControlMetricsAdapter {
    let height: CGFloat
    let fontSize: CGFloat
    let horizontalPadding: CGFloat

    init(node: XgentNode, theme: XgentPresentationTheme, mobile: Bool) {
        let small = node.size == "small" || (node.size == nil && node.variant == "compact")
        let token = small ? theme.control.small : node.size == "large" ? theme.control.large : theme.control.medium
        height = max(mobile ? 44 : 24, CGFloat(token))
        fontSize = CGFloat((small ? theme.typography.supporting : theme.typography.body) * theme.fontScale)
        horizontalPadding = CGFloat(small ? theme.spacing.sm : theme.spacing.md)
    }
}

enum XgentButtonEmphasis: Equatable {
    case primary, secondary, ghost, destructive

    init(node: XgentNode) {
        if node.destructive == true || node.variant == "destructive" { self = .destructive }
        else if node.prominent == true || node.variant == "primary" { self = .primary }
        else if node.variant == "ghost" { self = .ghost }
        else { self = .secondary }
    }
}

struct XgentActionButtonStyle: ButtonStyle {
    let node: XgentNode
    var iconOnly = false
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    @ScaledMetric(relativeTo: .body) private var scale = 1.0

    func makeBody(configuration: Configuration) -> some View {
        let palette = theme.palette(for: colorScheme)
        #if os(iOS)
        let metrics = XgentControlMetricsAdapter(node: node, theme: theme, mobile: true)
        #else
        let metrics = XgentControlMetricsAdapter(node: node, theme: theme, mobile: false)
        #endif
        let emphasis = XgentButtonEmphasis(node: node)
        let radius = iconOnly ? metrics.height / 2 : CGFloat(theme.radius.element)
        let background: Color = emphasis == .primary ? Color(xgentHex: palette.accent)
            : emphasis == .destructive ? Color(xgentHex: palette.error ?? "#e3193b")
            : emphasis == .ghost ? .clear : Color(xgentHex: palette.neutral ?? palette.muted)
        let foreground = emphasis == .primary ? palette.onAccent ?? "#ffffff"
            : emphasis == .destructive ? palette.onError ?? "#ffffff" : palette.text
        configuration.label
            .font(XgentFonts.body(theme.fontFamily, size: metrics.fontSize * scale, weight: .medium))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, iconOnly ? 0 : metrics.horizontalPadding)
            .padding(.vertical, CGFloat(theme.spacing.xs))
            .frame(minWidth: iconOnly ? metrics.height : nil, minHeight: metrics.height)
            .frame(maxWidth: node.fill == true ? .infinity : nil)
            .foregroundStyle(Color(xgentHex: foreground))
            .background(background, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color(xgentHex: palette.text).opacity(configuration.isPressed ? 0.1 : 0))
            }
            .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .opacity(isEnabled ? 1 : 0.48)
    }
}

struct XgentControlIcon: View {
    let name: String

    var body: some View {
        if name == "xgent.sidebar" {
            Path { path in
                path.move(to: CGPoint(x: 4, y: 8))
                path.addLine(to: CGPoint(x: 20, y: 8))
                path.move(to: CGPoint(x: 4, y: 16))
                path.addLine(to: CGPoint(x: 14, y: 16))
            }
            .stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .frame(width: 24, height: 24)
        } else {
            Image(systemName: name)
        }
    }
}

struct XgentIconButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        Button(role: XgentButtonEmphasis(node: node) == .destructive ? .destructive : nil) {
            model.send(node, in: document)
        } label: {
            if model.isBusy(node, in: document) { ProgressView().controlSize(.small) }
            else { XgentControlIcon(name: node.icon ?? "ellipsis") }
        }
        .buttonStyle(XgentActionButtonStyle(node: node, iconOnly: true))
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
    }
}

struct XgentActionButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        Button(role: XgentButtonEmphasis(node: node) == .destructive ? .destructive : nil) {
            model.send(node, in: document)
        } label: {
            HStack(spacing: 8) {
                if model.isBusy(node, in: document) { ProgressView().controlSize(.small) }
                else if let icon = node.icon { Image(systemName: icon) }
                Text(node.label ?? "").lineLimit(node.maxLines)
            }
        }
        .buttonStyle(XgentActionButtonStyle(node: node))
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
    }
}

struct XgentControlTypography: ViewModifier {
    let node: XgentNode
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .body) private var scale = 1.0

    func body(content: Content) -> some View {
        let small = node.size == "small" || (node.size == nil && node.variant == "compact")
        content.font(XgentFonts.body(theme.fontFamily, size: CGFloat((small ? theme.typography.supporting : theme.typography.body) * theme.fontScale) * scale))
    }
}

struct XgentFieldSurface: ViewModifier {
    let node: XgentNode
    var active = false
    var tracksFocus = true
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var focused: Bool

    @ViewBuilder func body(content: Content) -> some View {
        let palette = theme.palette(for: colorScheme)
        #if os(iOS)
        let metrics = XgentControlMetricsAdapter(node: node, theme: theme, mobile: true)
        #else
        let metrics = XgentControlMetricsAdapter(node: node, theme: theme, mobile: false)
        #endif
        let surface = content
            .modifier(XgentControlTypography(node: node))
            .padding(.horizontal, metrics.horizontalPadding)
            .padding(.vertical, CGFloat(theme.spacing.xs))
            .frame(maxWidth: .infinity, minHeight: metrics.height, alignment: .leading)
            .background(Color(xgentHex: palette.surface), in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                    .stroke(Color(xgentHex: focused || active ? palette.accent : palette.emphasizedBorder), lineWidth: focused || active ? 2 : 1)
                    .allowsHitTesting(false)
            }
        if !tracksFocus { surface }
        else {
        #if os(iOS)
        if node.secure == true { surface }
        else { surface.focused($focused) }
        #else
        surface.focused($focused)
        #endif
        }
    }
}

struct XgentFieldLabel: View {
    let node: XgentNode
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.xgentSettingsRow) private var isSettingsRow

    var body: some View {
        if node.variant != "compact", let label = node.label, !label.isEmpty {
            Text(label)
                .modifier(XgentControlTypography(node: node))
                .foregroundStyle(Color(xgentHex: isSettingsRow
                    ? theme.palette(for: colorScheme).text : theme.palette(for: colorScheme).secondaryText))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
    }
}
