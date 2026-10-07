#if os(macOS)
import AppKit
import SwiftUI

private struct XgentTerminalDockHeight: PreferenceKey {
    static let defaultValue: CGFloat = 240
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct XgentWorkspacePanelWidth: PreferenceKey {
    static let defaultValue: CGFloat = 420
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct XgentDesktopWorkspaceLayout<Main: View>: View {
    @ObservedObject var model: XgentPresentationModel
    let minimumMainWidth: CGFloat
    let enabled: Bool
    let main: Main
    @AppStorage("xgent.native.workspace-panel-width.v1") private var storedWidth = 420.0
    @AppStorage("xgent.native.terminal-dock-height.v1") private var storedDockHeight = 240.0
    @FocusState private var tabStripFocused: Bool

    init(model: XgentPresentationModel, minimumMainWidth: CGFloat, enabled: Bool,
         @ViewBuilder content: () -> Main) {
        self.model = model
        self.minimumMainWidth = minimumMainWidth
        self.enabled = enabled
        self.main = content()
    }

    private var panels: [XgentDocument] { model.documents.filter { $0.mode == .panel && $0.surface != model.workspaceState.dockedSurface } }
    private var selected: XgentDocument? {
        panels.first { $0.surface == model.workspaceState.selectedSurface } ?? panels.last
    }
    private var mainDocument: XgentDocument? {
        model.documents.last { $0.mode == .root && $0.node(id: "workspace-panel-actions") != nil }
    }

    private var docked: XgentDocument? {
        model.documents.first { $0.mode == .panel && $0.surface == model.workspaceState.dockedSurface }
    }

    var body: some View {
        GeometryReader { geometry in
            if enabled, let docked, let controls = docked.workspacePanel {
                VSplitView {
                    side(geometry: geometry).frame(minHeight: min(240, max(120, geometry.size.height * 0.5)))
                    panel(docked, controls: controls, canSplit: false, inDock: true)
                        .frame(minHeight: min(200, max(100, geometry.size.height * 0.35)),
                               idealHeight: storedDockHeight.isFinite ? storedDockHeight : 240,
                               maxHeight: max(100, geometry.size.height - min(240, max(120, geometry.size.height * 0.5)) - 8))
                        .background(GeometryReader { size in
                            Color.clear.preference(key: XgentTerminalDockHeight.self, value: size.size.height)
                        })
                }
                .onPreferenceChange(XgentTerminalDockHeight.self) { height in
                    guard height.isFinite, height >= 200 else { return }
                    storedDockHeight = Double(height)
                }
            } else { side(geometry: geometry) }
        }
    }

    @ViewBuilder private func side(geometry: GeometryProxy) -> some View {
        if enabled, let selected, let controls = selected.workspacePanel {
            let canSplit = XgentWorkspacePanelState.canSplit(width: geometry.size.width, minimumMainWidth: minimumMainWidth)
            if !model.workspaceState.visible {
                main.overlay(alignment: .topTrailing) {
                    if !model.windowChromeInstalled {
                        Button { model.workspaceState.visible = true } label: {
                            Label(controls.openLabel, systemImage: "sidebar.right")
                        }
                        .buttonStyle(.bordered)
                        .padding(8)
                        .accessibilityIdentifier("xgent-workspace-panel-show")
                    }
                }
            } else if canSplit, !model.workspaceState.expanded {
                HSplitView {
                    main.frame(minWidth: minimumMainWidth)
                    panel(selected, controls: controls, canSplit: true)
                        .frame(minWidth: 360,
                               idealWidth: XgentWorkspacePanelState.panelWidth(storedWidth, available: geometry.size.width,
                                                                              minimumMainWidth: minimumMainWidth),
                               maxWidth: max(360, geometry.size.width - minimumMainWidth - 8))
                        .background(GeometryReader { size in
                            Color.clear.preference(key: XgentWorkspacePanelWidth.self, value: size.size.width)
                        })
                }
                .onPreferenceChange(XgentWorkspacePanelWidth.self) { width in
                    guard width.isFinite, width >= 360 else { return }
                    storedWidth = Double(width)
                }
            } else {
                panel(selected, controls: controls, canSplit: canSplit)
            }
        } else {
            main
        }
    }

    private func panel(_ document: XgentDocument, controls: XgentWorkspacePanelControls, canSplit: Bool, inDock: Bool = false) -> some View {
        VStack(spacing: 0) {
            if !model.windowChromeInstalled || inDock || controls.dockLabel != nil {
                HStack(spacing: 4) {
                    if !inDock {
                        control(controls.returnLabel, icon: "arrow.left", id: "return") { model.workspaceState.visible = false }
                    }
                    ScrollViewReader { proxy in
                        ScrollView(.horizontal) {
                            HStack(spacing: 4) {
                                ForEach(inDock ? [document] : panels) { tab in
                                    XgentWorkspacePanelTab(document: tab, selected: tab.surface == document.surface,
                                                           select: {
                                        model.workspaceState.select(tab.surface)
                                        tabStripFocused = true
                                    }, model: model)
                                    .id(tab.surface)
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                        .focusable()
                        .focused($tabStripFocused)
                        .modifier(XgentTabKeyNavigation(ids: (inDock ? [document] : panels).map(\.surface), current: document.surface,
                            select: { model.workspaceState.select($0); return true }, close: {
                                guard document.dismissAction != nil, !model.isDismissing(document) else { return false }
                                model.dismiss(document)
                                return true
                            }))
                        .onAppear { proxy.scrollTo(document.surface) }
                        .onChange(of: document.surface) { _, id in proxy.scrollTo(id) }
                    }
                    if let mainDocument, let menu = mainDocument.node(id: "workspace-panel-actions") {
                        Menu {
                            XgentNativeMenuItems(nodes: menu.children ?? [], document: mainDocument, model: model)
                        } label: {
                            Image(systemName: menu.icon ?? "plus").frame(width: 28, height: 28)
                        }
                        .menuStyle(.button)
                        .menuIndicator(.hidden)
                        .buttonStyle(.plain)
                        .help(menu.label ?? "")
                        .accessibilityLabel(menu.accessibilityLabel ?? menu.label ?? "")
                        .accessibilityIdentifier(inDock ? "xgent-workspace-panel-dock-add" : "xgent-workspace-panel-add")
                    }
                    if let label = inDock ? controls.undockLabel : controls.dockLabel {
                        control(label, icon: "terminal", id: inDock ? "undock" : "dock") {
                            if inDock { model.workspaceState.restoreDock() }
                            else { model.workspaceState.dock(document.surface) }
                        }
                    }
                    if canSplit {
                        control(model.workspaceState.expanded ? controls.restoreLabel : controls.expandLabel,
                                icon: model.workspaceState.expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                                id: "expand") { model.workspaceState.expanded.toggle() }
                            .keyboardShortcut(KeyEquivalent(Character(String(UnicodeScalar(Int(NSEvent.SpecialKey.f11.rawValue))!))), modifiers: [])
                    }
                    control(controls.closeLabel, icon: inDock ? "xmark" : "sidebar.right", id: inDock ? "dock-close" : "close") {
                        if inDock { model.workspaceState.hideDock() }
                        else { model.workspaceState.visible = false }
                    }
                }
                .padding(6)
                Divider()
            }
            XgentNodeChildren(nodes: document.nodes, document: document, model: model)
                .id(document.surface)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(inDock ? "xgent-workspace-panel-dock-content" : "xgent-workspace-panel-content")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { XgentThemeBackground() }
        .preferredColorScheme(document.colorScheme)
        .modifier(XgentPresentationThemeModifier(theme: document.theme ?? .fallback, appearance: document.appearance))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(document.title)
    }

    private func control(_ label: String, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).frame(width: 28, height: 28) }
            .buttonStyle(.plain)
            .help(label)
            .accessibilityLabel(label)
            .accessibilityIdentifier("xgent-workspace-panel-\(id)")
    }
}
#endif
