import SwiftUI

struct XgentDesktopSettingsLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

    private var sidebar: XgentNode? { node.children?.first }
    private var detail: XgentNode? { (node.children ?? []).dropFirst().first }
    private var navigation: [XgentNode] {
        sidebar?.children?.first { $0.id == "settings-navigation" }?.children ?? []
    }
    private var search: XgentNode? { sidebar?.children?.first { $0.id == "settings-search" } }
    private var close: XgentNode? { sidebar?.children?.first { $0.id == "settings-close" } }
    private var sectionTitle: String { navigation.first { $0.selected == true }?.label ?? document.title }

    var body: some View {
        GeometryReader { geometry in
            if geometry.size.width >= 760 && !dynamicTypeSize.isAccessibilitySize {
                HStack(alignment: .top, spacing: 0) {
                    navigationColumn.frame(width: 240)
                    Divider()
                    detailContent
                }
            } else {
                VStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 12) {
                        if let search { XgentTextInput(node: search, document: document, model: model) }
                        HStack {
                            Menu {
                                XgentNativeMenuItems(nodes: navigation, document: document, model: model)
                            } label: {
                                Label(sectionTitle, systemImage: "chevron.down")
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .menuStyle(.button)
                            .menuIndicator(.hidden)
                            .buttonStyle(.plain)
                            .modifier(XgentControlTypography(node: node))
                            .accessibilityLabel(document.title)
                            .accessibilityValue(sectionTitle)
                            Spacer(minLength: 8)
                            if let close { XgentActionButton(node: close, document: document, model: model) }
                        }
                    }.padding(16)
                    Divider()
                    detailContent
                }
            }
        }
    }

    private var navigationColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(document.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let search { XgentTextInput(node: search, document: document, model: model) }
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(navigation) { item in
                        navigationItem(item)
                    }
                }
            }
            if let close { XgentActionButton(node: close, document: document, model: model) }
        }
        .padding(16)
        .frame(maxHeight: .infinity, alignment: .topLeading)
    }

    private func navigationItem(_ item: XgentNode) -> some View {
        let palette = theme.palette(for: colorScheme)
        return Button { model.send(item, in: document) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                if let icon = item.icon { Image(systemName: icon).frame(width: 20).accessibilityHidden(true) }
                Text(item.label ?? "").fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .modifier(XgentControlTypography(node: item))
            .fontWeight(item.selected == true ? .semibold : .regular)
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .background(item.selected == true ? Color(xgentHex: palette.neutral ?? palette.muted) : .clear,
                        in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.disabled == true || model.isBusy(item, in: document))
        .accessibilityIdentifier(item.id)
        .accessibilityLabel(item.accessibilityLabel ?? item.label ?? "")
        .accessibilityAddTraits(item.selected == true ? .isSelected : [])
    }

    @ViewBuilder private var detailContent: some View {
        if let detail {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: CGFloat(theme.spacing.lg)) {
                    ForEach(detail.children ?? []) { child in
                        XgentNodeView(node: child, document: document, model: model, parentAxis: .vertical)
                    }
                }
                .padding(20)
                .frame(maxWidth: 820, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct XgentDesktopSettingsCard: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: CGFloat(theme.spacing.md)) {
            if let label = node.label, !label.isEmpty {
                Text(label).modifier(XgentControlTypography(node: node)).fontWeight(.semibold)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            XgentNodeChildren(nodes: node.children ?? [], document: document, model: model, parentAxis: .vertical)
        }
        .padding(CGFloat(theme.spacing.lg))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: theme.palette(for: colorScheme).card), in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.container)))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.container))
                .stroke(Color(xgentHex: theme.palette(for: colorScheme).border), lineWidth: 1)
        }
    }
}
