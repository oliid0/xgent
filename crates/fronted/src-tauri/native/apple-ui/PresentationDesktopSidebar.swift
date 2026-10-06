#if os(macOS)
import SwiftUI

// Desktop navigation has a fixed header and footer, with just the workspace
// tree and conversation history scrolling between them.
struct XgentDesktopSidebar: View {
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .title2) private var titleSize: CGFloat = 24
    @ScaledMetric(relativeTo: .subheadline) private var sectionScale = 1.0

    private var layout: XgentNode? { document.nodes.first { $0.id == "sidebar-layout" } }
    private var children: [XgentNode] { layout?.children ?? [] }
    private var list: [XgentNode] { children.first { $0.id == "sidebar-list" }?.children ?? [] }
    private var footer: [XgentNode] { children.first { $0.id == "sidebar-footer" }?.children ?? [] }
    private var search: XgentNode? { children.first { $0.id == "sidebar-search-toggle" } }
    private var mode: XgentNode? { children.first { $0.id == "sidebar-execution-mode" } }
    private var close: XgentNode? { children.first { $0.id == "sidebar-close" } }
    private var createProject: XgentNode? { list.first { $0.id == "create-project" } }
    private let toolIDs: Set<String> = ["skills", "mcp", "files", "trajectory"]
    private var tools: [XgentNode] { list.filter { toolIDs.contains($0.id) } }
    private var history: [XgentNode] { list.filter { !toolIDs.contains($0.id) && $0.id != "create-project" } }
    private var palette: XgentPalette { theme.palette(for: colorScheme) }

    var body: some View {
        VStack(spacing: 0) {
            header
            VStack(spacing: 2) {
                if let newChat = footer.first(where: { $0.id == "new-chat" }) {
                    navigationRow(newChat, highlighted: true)
                }
                ForEach(tools) { tool in navigationRow(tool) }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 14)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(history) { item in historyItem(item) }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 16)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footerControls.padding(12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(xgentHex: palette.muted).opacity(0.5))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("xgent-desktop-sidebar")
    }

    private var header: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                if let mode {
                    XgentSelector(node: mode, document: document, model: model, showsLabel: false)
                } else {
                Text(children.first { $0.id == "sidebar-title" }?.text ?? document.title)
                    .font(XgentFonts.body(theme.fontFamily, size: titleSize * CGFloat(theme.fontScale), weight: .semibold))
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                }
                Spacer(minLength: 8)
                if let search {
                    Button { model.send(search, in: document) } label: {
                        Image(systemName: "magnifyingglass").frame(width: 32, height: 32)
                    }
                    .buttonStyle(.plain)
                    .disabled(search.disabled == true || model.isBusy(search, in: document))
                    .accessibilityIdentifier("sidebar-search-toggle")
                    .accessibilityLabel(search.accessibilityLabel ?? search.label ?? "")
                }
                if !model.windowChromeInstalled, let close {
                    Button { model.send(close, in: document) } label: {
                        Image(systemName: close.icon ?? "sidebar.leading").frame(width: 32, height: 32)
                    }
                    .buttonStyle(.plain)
                    .disabled(close.disabled == true)
                    .accessibilityIdentifier(close.id)
                    .accessibilityLabel(close.accessibilityLabel ?? close.label ?? "")
                }
            }
        }
        .padding(16)
    }

    private func navigationRow(_ item: XgentNode, highlighted: Bool = false) -> some View {
        Button { model.send(item, in: document) } label: {
            HStack(spacing: 10) {
                if let icon = item.icon { Image(systemName: icon).frame(width: 22).accessibilityHidden(true) }
                Text(item.label ?? "")
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .modifier(XgentControlTypography(node: item))
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .background(highlighted || item.selected == true ? Color(xgentHex: palette.neutral ?? palette.muted) : .clear,
                        in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.disabled == true || model.isBusy(item, in: document))
        .accessibilityIdentifier(item.id)
        .accessibilityLabel(item.accessibilityLabel ?? item.label ?? "")
        .accessibilityAddTraits(item.selected == true ? .isSelected : [])
    }

    @ViewBuilder private func historyItem(_ item: XgentNode) -> some View {
        if item.id == "projects-label" {
            if item.variant == "sidebar-section-heading" {
                XgentSidebarSectionHeading(node: item, document: document, model: model)
                    .padding(.horizontal, 10).padding(.bottom, 6)
            } else {
            HStack(spacing: 8) {
                sectionHeading(item)
                Spacer(minLength: 8)
                if let createProject {
                    Button { model.send(createProject, in: document) } label: {
                        Image(systemName: "plus").frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain)
                    .disabled(createProject.disabled == true || model.isBusy(createProject, in: document))
                    .accessibilityIdentifier(createProject.id)
                    .accessibilityLabel(createProject.accessibilityLabel ?? createProject.label ?? "")
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 6)
            }
        } else if item.id == "recents-label" {
            Divider().padding(.vertical, 10)
            sectionHeading(item).padding(.horizontal, 10).padding(.bottom, 6)
        } else {
            XgentNodeView(node: item, document: document, model: model, parentAxis: .vertical)
        }
    }

    private func sectionHeading(_ item: XgentNode) -> some View {
        Text(item.text ?? item.label ?? "")
            .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * sectionScale, weight: .semibold))
            .foregroundStyle(Color(xgentHex: palette.secondaryText))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    private var footerControls: some View {
        HStack(spacing: 8) {
            ForEach(footer.filter { $0.id != "new-chat" && $0.kind != .spacer }) { item in
                if item.id == "sidebar-soul-menu" {
                    XgentDesktopSoulMenu(node: item, document: document, model: model)
                        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                } else {
                    XgentNodeView(node: item, document: document, model: model, parentAxis: .horizontal)
                        .fixedSize()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
#endif
