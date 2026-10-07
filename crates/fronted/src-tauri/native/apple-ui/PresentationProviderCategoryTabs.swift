import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct XgentProviderCategoryToolbar: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            if let tabs = node.children?.first(where: { $0.variant == "provider-vendor-tabs" }) {
                XgentProviderCategoryTabs(node: tabs, document: document, model: model)
                    .frame(minWidth: 0, maxWidth: .infinity)
            }
            ForEach((node.children ?? []).filter { $0.variant != "provider-vendor-tabs" }) { action in
                XgentIconButton(node: action, document: document, model: model)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// Provider buckets are navigation, rather than a compact form input. Keep every
// named category reachable at narrow widths and bring the selected category into view.
struct XgentProviderCategoryTabs: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.layoutDirection) private var layoutDirection
    @ScaledMetric(relativeTo: .body) private var bodyScale = 1.0
    @State private var scrollTarget: String?

    private var options: [XgentOption] { node.options ?? [] }
    private var selected: String { model.value(node, in: document).text }
    private var iconSize: CGFloat { CGFloat(17 * theme.fontScale) * bodyScale }

    private var fontSize: CGFloat {
        let small = node.size == "small" || (node.size == nil && node.variant == "compact")
        #if os(iOS)
        let size = small ? 15.0 : 17.0
        #else
        let size = small ? theme.typography.supporting : theme.typography.body
        #endif
        return CGFloat(size * theme.fontScale) * bodyScale
    }

    private func textSize(_ option: XgentOption) -> CGSize {
        #if os(iOS)
        let font = XgentFonts.name(for: theme.fontFamily).flatMap { UIFont(name: $0, size: fontSize) }
            ?? .systemFont(ofSize: fontSize, weight: option.value == selected ? .semibold : .regular)
        #else
        let font = XgentFonts.name(for: theme.fontFamily).flatMap { NSFont(name: $0, size: fontSize) }
            ?? .systemFont(ofSize: fontSize, weight: option.value == selected ? .semibold : .regular)
        #endif
        return (option.label as NSString).size(withAttributes: [.font: font])
    }

    private var rowHeight: CGFloat { max(44, fontSize * 1.4 + 16) }

    var body: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal) {
                HStack(alignment: .center, spacing: 4) {
                    ForEach(options) { option in tab(option, viewportWidth: geometry.size.width).id(option.value) }
                }
                .scrollTargetLayout()
            }
            .frame(width: geometry.size.width, height: rowHeight)
            .scrollIndicators(.hidden)
            .scrollPosition(id: $scrollTarget, anchor: .center)
            .task(id: "\(selected):\(geometry.size.width):\(dynamicTypeSize):\(theme.fontScale):\(layoutDirection)") {
                scrollTarget = nil
                await Task.yield()
                guard !Task.isCancelled else { return }
                scrollTarget = selected
            }
            .focusable()
            .modifier(XgentTabKeyNavigation(
                ids: options.filter { $0.disabled != true }.map(\.value), current: selected,
                select: select, close: { false }))
        }
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
    }

    private func tab(_ option: XgentOption, viewportWidth: CGFloat) -> some View {
        let palette = theme.palette(for: scheme)
        let state = node.children?.first { $0.value?.text == option.value }
        let textWidth = min(ceil(textSize(option).width),
            max(1, viewportWidth - 24 - (state?.icon == nil ? 0 : iconSize + 8)))
        return Button { _ = select(option.value) } label: {
            HStack(spacing: 8) {
                if let icon = state?.icon {
                    Image(systemName: icon)
                        .font(.system(size: iconSize))
                        .frame(width: iconSize, height: iconSize)
                        .accessibilityHidden(true)
                }
                Text(option.label)
                    .modifier(XgentControlTypography(node: node))
                    .fontWeight(option.value == selected ? .semibold : .regular)
                    .lineLimit(1).truncationMode(.tail)
                    .frame(width: textWidth, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(minWidth: 44, minHeight: 44)
            .foregroundStyle(Color(xgentHex: option.value == selected ? palette.text : palette.secondaryText))
            .background(option.value == selected ? Color(xgentHex: palette.card) : .clear,
                in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner), style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true || option.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier("\(node.id):\(option.value)")
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(option.value == selected ? .isSelected : [])
        #if os(macOS)
        .help(option.label)
        #endif
    }

    private func select(_ value: String) -> Bool {
        guard node.disabled != true, !model.isBusy(node, in: document),
              options.contains(where: { $0.value == value && $0.disabled != true }) else { return false }
        model.send(node, in: document, value: .string(value), editing: true)
        return true
    }
}
