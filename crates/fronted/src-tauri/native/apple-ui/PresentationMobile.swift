#if os(iOS)
import Flow
import SwiftUI

// The complete compact application surface is handwritten. Wire nodes provide
// business state/actions, but generated component rendering is never used here.
private extension XgentNode {
    func child(id: String) -> XgentNode? { children?.first { $0.id == id } }
}

struct XgentIOSNavigationControl: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(.primary)
            .modifier(XgentGlassCircle())
    }
}

struct XgentIOSRootPresentation: View {
    let document: XgentDocument
    let sidebar: XgentDocument?
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var transition: Animation? {
        guard !reduceMotion else { return nil }
        let motion = (document.theme ?? .fallback).motion
        return .timingCurve(motion.curve[0], motion.curve[1], motion.curve[2], motion.curve[3],
                            duration: motion.medium / 1_000)
    }

    var body: some View {
        GeometryReader { geometry in
            // Astryx MobileNav is `width: 100vw; max-width: 320px`, but its
            // public contract also caps the drawer at 85vw on narrow screens.
            let drawerWidth = min(320, geometry.size.width * 0.85)
            ZStack(alignment: .leading) {
                XgentIOSChatPresentation(document: document, model: model, isObscured: sidebar != nil)
                    // The composer retires its glass/keyboard while obscured.
                    // Keep the rounded page edge visible beside the drawer.
                    .clipShape(RoundedRectangle(cornerRadius: sidebar == nil ? 0 : 26,
                                                style: .continuous))
                    .offset(x: sidebar == nil ? 0 : drawerWidth)
                    .accessibilityHidden(sidebar != nil)
                    .allowsHitTesting(sidebar == nil)
                    .zIndex(0)
                if let sidebar {
                    Button { model.dismiss(sidebar) } label: {
                        Color.black.opacity(0.32).contentShape(Rectangle()).ignoresSafeArea()
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Close sidebar"))
                    .zIndex(100)
                    XgentIOSSidebarPresentation(document: sidebar, model: model)
                        .frame(width: drawerWidth, height: geometry.size.height)
                        .overlay(alignment: .trailing) {
                            Rectangle()
                                .fill(Color.primary.opacity(0.08))
                                .frame(width: 1)
                        }
                        .clipped()
                        .zIndex(101)
                        .transition(.move(edge: .leading))
                        .gesture(DragGesture().onEnded {
                            if $0.translation.width < -60 { model.dismiss(sidebar) }
                        })
                }
            }
            .animation(transition, value: sidebar?.id)
            .clipped()
        }
    }
}

// Browser, file, Git and workspace tools share the compact Astryx fullscreen
// contract: one fixed header followed by a flexible native content region.
struct XgentIOSWorkspacePresentation: View {
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var layout: XgentNode? { document.nodes.first { $0.kind == .browserLayout } }

    var body: some View {
        Group {
            if let layout, let toolbar = layout.child(id: "browser-toolbar") {
                // Keep the browser chrome at its intrinsic height and give the
                // live WebKit viewport the entire remaining iPhone surface.
                VStack(spacing: 0) {
                    XgentIOSNode(node: toolbar, document: document, model: model,
                                 parentAxis: .vertical)
                    if let error = layout.child(id: "browser-error") {
                        XgentIOSNode(node: error, document: document, model: model,
                                     parentAxis: .vertical)
                    }
                    if let viewport = layout.children?.first(where: {
                        $0.kind == .browserViewport || $0.id == "browser-preparing"
                    }) {
                        XgentIOSNode(node: viewport, document: document, model: model,
                                     parentAxis: .vertical)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let layout {
                // BrowserPanel, MobileFilesPanel and the other compact tools
                // already serialize the Astryx order. Do not lift their first
                // HStack into a system navigation bar: that changes both the
                // hierarchy and the available height of the flexible content.
                XgentIOSNode(node: layout, document: document, model: model)
            } else {
                XgentIOSNodes(nodes: document.nodes, document: document, model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { XgentThemeBackground().ignoresSafeArea() }
    }
}

// A native compact root never falls back to the generated application-layout
// recursion. Serialized full-page VStacks keep their fixed Astryx header and
// flexible content; legacy flat pages receive the same custom compact header.
struct XgentIOSPagePresentation: View {
    let document: XgentDocument
    let sidebar: XgentDocument?
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var serializedLayout: XgentNode? {
        document.nodes.count == 1 && document.nodes.first?.kind == .vStack
            ? document.nodes.first
            : nil
    }
    private var transition: Animation? {
        guard !reduceMotion else { return nil }
        let motion = (document.theme ?? .fallback).motion
        return .timingCurve(motion.curve[0], motion.curve[1], motion.curve[2], motion.curve[3],
                            duration: motion.medium / 1_000)
    }

    @ViewBuilder private var page: some View {
        if document.nodes.isEmpty {
            XgentThemeBackground()
        } else if document.mode == .root,
                  let error = document.nodes.first(where: { $0.kind == .banner && $0.variant == "error-screen" }) {
            ScrollView { XgentErrorScreen(node: error, document: document, model: model) }
        } else if let serializedLayout {
            XgentIOSNode(node: serializedLayout, document: document, model: model)
        } else {
            VStack(spacing: 0) {
                XgentIOSPageHeader(title: document.title, document: document, model: model)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        XgentIOSNodes(nodes: document.nodes.filter { $0.id != "close" },
                                      document: document, model: model)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
    }

    var body: some View {
        GeometryReader { geometry in
            let drawerWidth = min(320, geometry.size.width * 0.85)
            ZStack(alignment: .leading) {
                page
                    .opacity(sidebar == nil ? 1 : 0)
                    .accessibilityHidden(sidebar != nil)
                    .allowsHitTesting(sidebar == nil)
                    .zIndex(0)
                if let sidebar {
                    Button { model.dismiss(sidebar) } label: {
                        Color.black.opacity(0.32).contentShape(Rectangle()).ignoresSafeArea()
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Close sidebar"))
                    .zIndex(100)
                    XgentIOSSidebarPresentation(document: sidebar, model: model)
                        .frame(width: drawerWidth, height: geometry.size.height)
                        .overlay(alignment: .trailing) {
                            Rectangle().fill(Color.primary.opacity(0.08)).frame(width: 1)
                        }
                        .clipped()
                        .zIndex(101)
                        .transition(.move(edge: .leading))
                        .gesture(DragGesture().onEnded {
                            if $0.translation.width < -60 { model.dismiss(sidebar) }
                        })
                }
            }
            .animation(transition, value: sidebar?.id)
            .clipped()
        }
        .background { XgentThemeBackground().ignoresSafeArea() }
    }
}

private struct XgentIOSChatPresentation: View {
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    let isObscured: Bool
    private var chat: XgentNode? { document.nodes.first { $0.kind == .chatLayout } }
    private var toolbar: XgentNode? { chat?.child(id: "toolbar") }
    private var sidebarControl: XgentNode? { toolbar?.child(id: "sidebar") }
    private var toolsControl: XgentNode? { toolbar?.child(id: "tools") }
    private var transcript: XgentNode? { chat?.child(id: "transcript") }
    private var composer: XgentNode? { chat?.child(id: "composer") }
    private var inlineNodes: [XgentNode] {
        (chat?.children ?? []).filter { !["toolbar", "transcript", "composer"].contains($0.id) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                if let sidebarControl {
                    XgentIOSNode(node: sidebarControl, document: document, model: model)
                }
                Spacer(minLength: 0)
                Text(document.title).font(.headline.weight(.semibold)).lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if let toolsControl {
                    XgentIOSNode(node: toolsControl, document: document, model: model)
                }
            }
            .frame(minHeight: 68)
            .padding(.horizontal, 12)
            if !inlineNodes.isEmpty {
                VStack(spacing: 8) {
                    XgentIOSNodes(nodes: inlineNodes, document: document, model: model)
                }
                .padding(.horizontal, 12)
            }
            if let transcript {
                XgentIOSTranscript(node: transcript, document: document, model: model)
                    .id(transcript.value?.text ?? transcript.id)
            } else {
                Spacer(minLength: 0)
            }
            // Retire the material and keyboard while navigation is open.
            // Ancestor opacity leaves this glass shape in its container.
            // Drafts remain in the shared presentation model.
            if !isObscured, let composer {
                XgentIOSComposer(node: composer, document: document, model: model)
                    .transition(.identity)
            }
        }
        .background { XgentThemeBackground().ignoresSafeArea() }
    }
}

private struct XgentIOSTranscript: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var followsLatest = true
    @State private var userScrolling = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(node.children ?? []) { child in
                        XgentIOSNode(node: child, document: document, model: model).id(child.id)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentSize.height - geometry.visibleRect.maxY < 80
            } action: { _, atBottom in
                if userScrolling || atBottom { followsLatest = atBottom }
            }
            .onScrollPhaseChange { _, phase in
                userScrolling = phase == .interacting || phase == .decelerating
            }
            .onAppear { scrollToLatest(using: proxy, animated: false) }
            .onChange(of: document.revision) { _, _ in
                if followsLatest && !userScrolling { scrollToLatest(using: proxy, animated: false) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func scrollToLatest(using proxy: ScrollViewProxy, animated: Bool) {
        guard let last = node.children?.last else { return }
        if animated && !reduceMotion {
            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last.id, anchor: .bottom) }
        } else {
            proxy.scrollTo(last.id, anchor: .bottom)
        }
    }
}

struct XgentIOSComposer: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    private var activity: XgentNode? { node.child(id: "activity-strip") }
    private var queue: XgentNode? { node.child(id: "queued-turns") }
    private var suggestions: XgentNode? { node.child(id: "composer-suggestions") }
    private var input: XgentNode? { node.child(id: "draft") }
    private var actions: XgentNode? { node.child(id: "composer-actions") }
    private var feedback: [XgentNode] {
        (node.children ?? []).filter { ["voice-error", "voice-partial"].contains($0.id) }
    }
    private var supporting: [XgentNode] {
        (node.children ?? []).filter {
            !["queued-turns", "activity-strip", "draft", "composer-actions", "voice-error", "voice-partial", "composer-suggestions"].contains($0.id)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let queue {
                XgentIOSNode(node: queue, document: document, model: model)
                    .id(queue.value?.text ?? queue.id)
            }
            if let activity {
                HFlow(itemSpacing: 8, rowSpacing: 8) {
                    XgentIOSNodes(nodes: activity.children ?? [], document: document, model: model, parentAxis: .horizontal)
                }
            }
            if let input { XgentIOSNode(node: input, document: document, model: model) }
            XgentIOSNodes(nodes: feedback, document: document, model: model, parentAxis: .vertical)
            if !supporting.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        XgentIOSNodes(nodes: supporting, document: document, model: model, parentAxis: .horizontal)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            if let actions {
                XgentIOSComposerActions(nodes: actions.children ?? [], document: document, model: model)
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(alignment: .top) {
            if let suggestions {
                XgentComposerSuggestions(node: suggestions, document: document, model: model, floatsAboveInput: true)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

}

private struct XgentIOSSidebarPresentation: View {
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    private var layout: XgentNode? { document.nodes.first }
    private var title: XgentNode? { layout?.child(id: "sidebar-title") }
    private var mode: XgentNode? { layout?.child(id: "sidebar-execution-mode") }
    private var searchToggle: XgentNode? { layout?.child(id: "sidebar-search-toggle") }
    private var search: XgentNode? { layout?.child(id: "sidebar-search") }
    private var list: XgentNode? { layout?.child(id: "sidebar-list") }
    private var footer: XgentNode? { layout?.child(id: "sidebar-footer") }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                if let mode {
                    XgentSelector(node: mode, document: document, model: model, showsLabel: false)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if let title {
                    Text(title.text ?? title.label ?? "Xgent")
                        .font(.title2.weight(.bold))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityAddTraits(.isHeader)
                } else { Spacer(minLength: 0) }
                if let searchToggle {
                    XgentIOSNode(node: searchToggle, document: document, model: model)
                        .modifier(XgentIOSNavigationControl())
                }
                Button { model.dismiss(document) } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .modifier(XgentIOSNavigationControl())
                .accessibilityLabel(Text("Close sidebar"))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            if let search {
                XgentIOSNode(node: search, document: document, model: model)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
            if let list {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(list.children ?? []) { child in
                            XgentIOSNode(node: child, document: document, model: model)
                                .padding(.horizontal, 8)
                                .padding(.vertical, child.kind == .heading ? 8 : 0)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if let footer { XgentIOSSidebarFooter(node: footer, document: document, model: model) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { XgentThemeBackground().ignoresSafeArea() }
        .preferredColorScheme(document.colorScheme)
        .modifier(XgentPresentationThemeModifier(theme: document.theme ?? .fallback,
                                                  appearance: document.appearance))
    }
}

private struct XgentIOSSidebarFooter: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var newChat: XgentNode? { node.child(id: "new-chat") }
    private var settings: XgentNode? { node.child(id: "settings") }

    var body: some View {
        HStack(spacing: 8) {
            if let newChat {
                Button { model.send(newChat, in: document) } label: {
                    Label(newChat.label ?? "", systemImage: newChat.icon ?? "square.and.pencil")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(.white)
                        .background(Color(xgentHex: palette.accent), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(newChat.accessibilityLabel ?? newChat.label ?? "")
                .accessibilityIdentifier(newChat.id)
            }
            if let settings {
                XgentSidebarSettingsButton(node: settings, document: document, model: model)
            }
            if let update = node.children?.first(where: { $0.id == "sidebar-update" }) {
                XgentSidebarUpdateButton(node: update, document: document, model: model)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

private struct XgentIOSPageHeader: View {
    let title: String
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        HStack(spacing: 8) {
            Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
            if document.dismissAction != nil {
                Button { model.dismiss(document) } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .modifier(XgentIOSNavigationControl())
                .accessibilityLabel(Text("Close"))
            } else {
                Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
            }
        }
        .frame(minHeight: 68)
        .padding(.horizontal, 12)
    }
}

struct XgentIOSSheetPresentation: View {
    let initialDocument: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var document: XgentDocument {
        // A sheet's route updates retain its surface ID. Resolve only that
        // surface so an unrelated sheet cannot replace this sheet's content.
        model.documents.first { $0.mode == .sheet && $0.id == initialDocument.id }
            ?? initialDocument
    }
    private var nextSheet: XgentDocument? {
        let sheets = model.documents.filter { $0.mode == .sheet }
        guard let index = sheets.firstIndex(where: { $0.id == document.id }), index + 1 < sheets.count else { return nil }
        return sheets[index + 1]
    }
    private var back: XgentNode? { document.nodes.first { $0.id == "back" } }
    private var saveStatus: XgentNode? {
        document.nodes.first { $0.id == "save-status" && $0.secondary != true }
    }
    private var visibleNodes: [XgentNode] {
        document.nodes.filter { $0.id != "back" && $0.id != "save-status" }
    }
    private var grouped: Bool {
        visibleNodes.contains { $0.kind == .settingsGroup || $0.variant == "other-settings-area" }
    }
    private var list: XgentNode? {
        visibleNodes.count == 1 && visibleNodes.first?.kind == .list ? visibleNodes.first : nil
    }

    private var contentNodes: [XgentNode] { list?.children ?? visibleNodes }
    private var isSettingsIndex: Bool {
        back == nil && contentNodes.contains { $0.kind == .settingsGroup && $0.id == "mobile-theme" }
    }
    private var isSettingsSession: Bool {
        document.surface == "settings" || document.surface.hasPrefix("settings:")
    }
    private var detents: Set<PresentationDetent> {
        list == nil ? [.large] : [.fraction(0.62), .large]
    }

    @ViewBuilder private var leadingNavigation: some View {
        if let back {
            Button { model.send(back, in: document) } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .modifier(XgentIOSNavigationControl())
            .disabled(back.disabled == true || model.isBusy(back, in: document))
            .accessibilityLabel(back.label ?? "Back")
            .accessibilityIdentifier(back.id)
        } else {
            Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
        }
    }

    @ViewBuilder private var trailingNavigation: some View {
        if document.dismissAction != nil && (!isSettingsSession || back == nil) {
            Button { model.dismiss(document) } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .modifier(XgentIOSNavigationControl())
            .accessibilityLabel(Text("Close"))
            .accessibilityIdentifier("presentation-sheet-close")
        } else {
            Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
        }
    }

    private var title: some View {
        Text(document.title)
            .accessibilityIdentifier("presentation-sheet-title")
            .font(.headline.weight(.semibold))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityAddTraits(.isHeader)
    }

    private func statusText(_ node: XgentNode) -> some View {
        Text(node.text ?? "")
            .font(.subheadline)
            .foregroundStyle(node.secondary == true ? Color.secondary : Color.red)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(node.id)
    }

    private var header: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 8) {
                    HStack {
                        leadingNavigation
                        Spacer(minLength: 0)
                        trailingNavigation
                    }
                    title.fixedSize(horizontal: false, vertical: true)
                }
            } else {
                HStack(spacing: 8) {
                    leadingNavigation
                    title.lineLimit(2)
                    trailingNavigation
                }
            }
        }
        .frame(minHeight: 68)
        .padding(.horizontal, 12)
    }

    var body: some View {
        VStack(spacing: 0) {
            if isSettingsIndex {
                HStack {
                    Spacer(minLength: 0)
                    trailingNavigation
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
            } else {
                header
            }
            if let saveStatus {
                statusText(saveStatus)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
            if grouped {
                XgentIOSSettingsForm(nodes: contentNodes, document: document, model: model)
            } else if contentNodes.contains(where: { $0.kind == .terminalLayout || $0.variant == "workspace-search-palette" }) {
                XgentIOSNodes(nodes: contentNodes, document: document, model: model)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        XgentIOSNodes(nodes: contentNodes, document: document, model: model)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .id(document.id)
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background { XgentThemeBackground().ignoresSafeArea() }
        // Astryx menus use the capped sheet budget while settings and detail
        // surfaces use the tall budget. Long pages must never open at medium.
        .presentationDetents(detents)
        .presentationDragIndicator(.hidden)
        .presentationCornerRadius(grouped ? 36 : nil)
        .preferredColorScheme(document.colorScheme)
        .interactiveDismissDisabled(document.dismissAction == nil)
        .sheet(item: Binding(get: { nextSheet }, set: { if $0 == nil, let nextSheet { model.dismiss(nextSheet) } })) { next in
            AnyView(XgentIOSSheetPresentation(initialDocument: next, model: model))
        }
        .modifier(XgentAlerts(model: model, enabled: nextSheet == nil))
        .modifier(XgentNotificationOverlay(model: model, enabled: nextSheet == nil))
        .modifier(XgentPresentationThemeModifier(theme: document.theme ?? .fallback,
                                                  appearance: document.appearance))
    }
}
#endif
