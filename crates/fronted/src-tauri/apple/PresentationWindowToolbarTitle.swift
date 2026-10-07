#if os(macOS)
import SwiftUI
import AppKit

@MainActor
struct XgentWindowToolbarTitle: View {
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.colorScheme) private var scheme
    private var context: XgentWindowToolbarContext { XgentWindowToolbarContext(model: model) }
    private var palette: XgentPalette {
        (context.root?.theme ?? .fallback).palette(for: context.root?.colorScheme ?? scheme)
    }

    var body: some View {
        Group {
            if let root = context.titleDocument {
                GeometryReader { geometry in
                    HStack(spacing: 8) {
                        title(root, compact: geometry.size.width < 360)
                            .frame(maxWidth: geometry.size.width < 360 ? .infinity : 160)
                        if geometry.size.width >= 360, !context.tabs.isEmpty {
                            tabStrip
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .modifier(XgentPresentationThemeModifier(theme: root.theme ?? .fallback, appearance: root.appearance))
            }
        }
        .frame(height: 44)
        .accessibilityIdentifier("xgent-window-title-tabs")
    }

    @ViewBuilder private func title(_ root: XgentDocument, compact: Bool) -> some View {
        if context.supportsPanels { titleMenu(root, compact: compact) }
        else { Text(root.title).font(.system(size: 13, weight: .semibold)).lineLimit(1).truncationMode(.middle) }
    }

    private func titleMenu(_ root: XgentDocument, compact: Bool) -> some View {
        Menu {
            Button(root.title) { model.workspaceState.visible = false }
                .disabled(context.selectedPanel == nil)
                .accessibilityIdentifier("xgent-window-return-chat")
            ForEach(context.tabs) { tab in
                Button { tab.select(model) } label: {
                    if tab.selected { Label(tab.title, systemImage: "checkmark") }
                    else { Text(tab.title) }
                }
                .help(tab.subtitle.isEmpty ? tab.title : "\(tab.title)\n\(tab.subtitle)")
                .disabled(tab.action?.disabled == true)
            }
            if let panel = context.selectedPanel, let controls = panel.workspacePanel {
                Button(model.workspaceState.expanded ? controls.restoreLabel : controls.expandLabel) {
                    model.workspaceState.expanded.toggle()
                }
                .accessibilityIdentifier("xgent-window-expand-panel")
                .keyboardShortcut(KeyEquivalent(Character(String(UnicodeScalar(Int(NSEvent.SpecialKey.f11.rawValue))!))), modifiers: [])
                Button(controls.closeLabel) { model.workspaceState.visible = false }
                if let close = context.closeAction {
                    Button(close.node.label ?? controls.closeTabLabel ?? controls.closeLabel) { context.closeSelectedTab() }
                        .disabled(close.node.disabled == true || model.isBusy(close.node, in: close.document))
                } else if panel.dismissAction != nil {
                    Button(controls.closeTabLabel ?? controls.closeLabel) { context.closeSelectedTab() }
                        .disabled(model.isDismissing(panel))
                }
                if let add = panel.node(id: "browser-new") {
                    Button(add.label ?? "") { model.send(add, in: panel) }
                        .disabled(add.disabled == true || model.isBusy(add, in: panel))
                }
                if let close = panel.node(id: "browser-header-close") {
                    Button(close.label ?? "") { model.send(close, in: panel) }
                        .disabled(close.disabled == true || model.isBusy(close, in: panel))
                }
                if let status = panel.node(id: "browser-status")?.text { Text(status) }
            }
            if let menu = root.node(id: "workspace-panel-actions") {
                XgentNativeMenuItems(nodes: menu.children ?? [], document: root, model: model)
            }
            if let tools = root.node(id: "tools") {
                Button(tools.label ?? "") { model.send(tools, in: root) }
                    .disabled(tools.disabled == true || model.isBusy(tools, in: root))
            }
            if let sideChat = root.node(id: "new-side-chat") {
                Button(sideChat.label ?? "") { model.send(sideChat, in: root) }
                    .disabled(sideChat.disabled == true || model.isBusy(sideChat, in: root))
            }
        } label: {
            VStack(spacing: 2) {
                Text(compact ? context.selectedTitle : root.title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                if compact, let tab = context.tabs.first(where: { $0.selected }), !tab.subtitle.isEmpty {
                    Text(tab.subtitle).font(.system(size: 11)).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 32)
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .help(context.selectedTitle)
        .accessibilityLabel(context.selectedTitle)
        .accessibilityIdentifier("xgent-window-title-menu")
    }

    private var tabStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(context.tabs) { tab in
                        Button { tab.select(model) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 5) {
                                    Text(tab.title).font(.system(size: 12, weight: tab.selected ? .semibold : .regular))
                                        .lineLimit(1)
                                    if tab.editor, tab.action?.current == 1 {
                                        Circle().fill(.tint).frame(width: 5, height: 5).accessibilityHidden(true)
                                    }
                                }
                                if !tab.subtitle.isEmpty {
                                    Text(tab.subtitle).font(.system(size: 10)).foregroundStyle(.secondary)
                                        .lineLimit(1).truncationMode(.middle)
                                }
                            }
                            .frame(minWidth: 72, maxWidth: 180, minHeight: 32, alignment: .leading)
                            .padding(.horizontal, 8)
                            .background(tab.selected ? Color(xgentHex: palette.muted) : .clear,
                                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(tab.action?.disabled == true || (tab.action.map { model.isBusy($0, in: tab.document) } ?? false))
                        .help(tab.subtitle.isEmpty ? tab.title : "\(tab.title)\n\(tab.subtitle)")
                        .accessibilityLabel(tab.title)
                        .accessibilityValue(tab.subtitle)
                        .accessibilityAddTraits(tab.selected ? [.isSelected] : [])
                        .accessibilityIdentifier("xgent-window-tab:\(tab.id)")
                        .id(tab.id)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .focusable()
            .modifier(XgentTabKeyNavigation(ids: context.tabs.map(\.id), current: context.tabs.first(where: { $0.selected })?.id,
                select: { id in
                    guard let tab = context.tabs.first(where: { $0.id == id }), tab.action?.disabled != true else { return false }
                    tab.select(model)
                    return true
                }, close: { context.closeSelectedTab() }))
            .onAppear { if let tab = context.tabs.first(where: { $0.selected }) { proxy.scrollTo(tab.id) } }
            .onChange(of: context.tabs.first(where: { $0.selected })?.id) { _, id in
                if let id { proxy.scrollTo(id) }
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity)
    }
}
#endif
