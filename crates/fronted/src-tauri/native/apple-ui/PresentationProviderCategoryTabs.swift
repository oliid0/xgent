import SwiftUI

private struct XgentProviderCategoryWidth: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

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
    @State private var viewportWidth: CGFloat = 240

    private var options: [XgentOption] { node.options ?? [] }
    private var selected: String { model.value(node, in: document).text }
    private var iconSize: CGFloat { CGFloat(17 * theme.fontScale) * bodyScale }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(alignment: .center, spacing: 4) {
                    ForEach(options) { option in tab(option).id(option.value) }
                }
            }
            .scrollIndicators(.hidden)
            .background {
                GeometryReader { geometry in
                    Color.clear.preference(key: XgentProviderCategoryWidth.self, value: geometry.size.width)
                }
            }
            .onPreferenceChange(XgentProviderCategoryWidth.self) { viewportWidth = $0 }
            .onAppear { revealSelection(proxy) }
            .onChange(of: selected) { _, _ in revealSelection(proxy) }
            .onChange(of: viewportWidth) { _, _ in revealSelection(proxy) }
            .onChange(of: dynamicTypeSize) { _, _ in revealSelection(proxy) }
            .onChange(of: theme.fontScale) { _, _ in revealSelection(proxy) }
            .onChange(of: layoutDirection) { _, _ in revealSelection(proxy) }
            .focusable()
            .modifier(XgentTabKeyNavigation(
                ids: options.filter { $0.disabled != true }.map(\.value), current: selected,
                select: select, close: { false }))
        }
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 44)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
    }

    private func tab(_ option: XgentOption) -> some View {
        let palette = theme.palette(for: scheme)
        let state = node.children?.first { $0.value?.text == option.value }
        return Button { _ = select(option.value) } label: {
            XgentProviderCategoryLabelLayout(maximumWidth: max(20, viewportWidth - 24), direction: layoutDirection) {
                if let icon = state?.icon {
                    Image(systemName: icon)
                        .font(.system(size: iconSize))
                        .frame(width: iconSize, height: iconSize)
                        .accessibilityHidden(true)
                }
                Text(option.label)
                    .modifier(XgentControlTypography(node: node))
                    .fontWeight(option.value == selected ? .semibold : .regular)
                    .fixedSize(horizontal: false, vertical: true)
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

    private func revealSelection(_ proxy: ScrollViewProxy) {
        // The tab's wrapping height/width changes with the viewport. Scroll
        // after that layout has committed, using the selected tab's new bounds.
        DispatchQueue.main.async { proxy.scrollTo(selected, anchor: .center) }
    }

    private func select(_ value: String) -> Bool {
        guard node.disabled != true, !model.isBusy(node, in: document),
              options.contains(where: { $0.value == value && $0.disabled != true }) else { return false }
        model.send(node, in: document, value: .string(value), editing: true)
        return true
    }
}

private struct XgentProviderCategoryLabelLayout: Layout {
    let maximumWidth: CGFloat
    let direction: LayoutDirection

    private func sizes(_ subviews: Subviews) -> [CGSize] {
        guard let text = subviews.last else { return [] }
        let icon = subviews.count > 1 ? subviews[0].sizeThatFits(.unspecified) : .zero
        let spacing: CGFloat = subviews.count > 1 ? 8 : 0
        let available = max(1, maximumWidth - icon.width - spacing)
        let ideal = text.sizeThatFits(.unspecified)
        let wrapped = text.sizeThatFits(ProposedViewSize(width: min(available, ideal.width), height: nil))
        return subviews.count > 1 ? [icon, wrapped] : [wrapped]
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let measured = sizes(subviews)
        return CGSize(width: measured.reduce(0) { $0 + $1.width } + (measured.count > 1 ? 8 : 0),
                      height: measured.map(\.height).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let measured = sizes(subviews)
        var offset: CGFloat = 0
        for (index, view) in subviews.enumerated() {
            let size = measured[index]
            let x = direction == .rightToLeft ? bounds.maxX - offset - size.width : bounds.minX + offset
            view.place(at: CGPoint(x: x, y: bounds.midY - size.height / 2),
                       proposal: ProposedViewSize(size))
            offset += size.width + 8
        }
    }
}
