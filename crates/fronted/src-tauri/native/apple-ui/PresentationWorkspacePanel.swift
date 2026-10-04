#if os(macOS)
import AppKit
import SwiftUI

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
    @State private var state = XgentWorkspacePanelState()
    @FocusState private var tabStripFocused: Bool

    init(model: XgentPresentationModel, minimumMainWidth: CGFloat, enabled: Bool,
         @ViewBuilder content: () -> Main) {
        self.model = model
        self.minimumMainWidth = minimumMainWidth
        self.enabled = enabled
        self.main = content()
    }

    private var panels: [XgentDocument] { model.documents.filter { $0.mode == .panel } }
    private var identities: [XgentWorkspacePanelIdentity] {
        panels.map { XgentWorkspacePanelIdentity(surface: $0.surface, focusRequest: $0.workspacePanel?.focusRequest ?? 0) }
    }
    private var selected: XgentDocument? {
        panels.first { $0.surface == state.selectedSurface } ?? panels.last
    }
    private var mainDocument: XgentDocument? {
        model.documents.last { $0.mode == .root && $0.node(id: "workspace-panel-actions") != nil }
    }

    var body: some View {
        GeometryReader { geometry in
            if enabled, let selected, let controls = selected.workspacePanel {
                let canSplit = XgentWorkspacePanelState.canSplit(width: geometry.size.width, minimumMainWidth: minimumMainWidth)
                if !state.visible {
                    main.overlay(alignment: .topTrailing) {
                        Button { state.visible = true } label: {
                            Label(controls.openLabel, systemImage: "sidebar.right")
                        }
                        .buttonStyle(.bordered)
                        .padding(8)
                        .accessibilityIdentifier("xgent-workspace-panel-show")
                    }
                } else if canSplit, !state.expanded {
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
        .onAppear { state.synchronize(identities) }
        .onChange(of: identities) { _, values in state.synchronize(values) }
    }

    private func panel(_ document: XgentDocument, controls: XgentWorkspacePanelControls, canSplit: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                control(controls.returnLabel, icon: "arrow.left", id: "return") { state.visible = false }
                ScrollViewReader { proxy in
                    ScrollView(.horizontal) {
                        HStack(spacing: 4) {
                            ForEach(panels) { tab in
                                XgentWorkspacePanelTab(document: tab, selected: tab.surface == document.surface,
                                                       select: {
                                    state.select(tab.surface)
                                    tabStripFocused = true
                                }, model: model)
                                .id(tab.surface)
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    .focusable()
                    .focused($tabStripFocused)
                    .modifier(XgentTabKeyNavigation(ids: panels.map(\.surface), current: document.surface,
                        select: { state.select($0); return true }, close: {
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
                    .accessibilityIdentifier("xgent-workspace-panel-add")
                }
                if canSplit {
                    control(state.expanded ? controls.restoreLabel : controls.expandLabel,
                            icon: state.expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
                            id: "expand") { state.expanded.toggle() }
                        .keyboardShortcut(KeyEquivalent(Character(String(UnicodeScalar(Int(NSEvent.SpecialKey.f11.rawValue))!))), modifiers: [])
                }
                control(controls.closeLabel, icon: "sidebar.right", id: "close") { state.visible = false }
            }
            .padding(6)
            Divider()
            XgentNodeChildren(nodes: document.nodes, document: document, model: model)
                .id(document.surface)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .accessibilityIdentifier("xgent-workspace-panel-content")
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
