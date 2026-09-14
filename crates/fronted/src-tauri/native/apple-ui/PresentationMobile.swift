#if os(iOS)
import SwiftUI

// The complete compact application surface is handwritten. Wire nodes provide
// business state/actions, but generated component rendering is never used here.
private extension XgentNode {
    func child(id: String) -> XgentNode? { children?.first { $0.id == id } }
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
            let drawerWidth = min(320, geometry.size.width)
            ZStack(alignment: .leading) {
                XgentIOSChatPresentation(document: document, model: model)
                    .accessibilityIdentifier("xgent-native-root")
                    .accessibilityHidden(sidebar != nil)
                    .allowsHitTesting(sidebar == nil)
                if let sidebar {
                    Button { model.dismiss(sidebar) } label: {
                        Color.black.opacity(0.32).contentShape(Rectangle()).ignoresSafeArea()
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Close sidebar"))
                    XgentIOSSidebarPresentation(document: sidebar, model: model)
                        .frame(width: drawerWidth, height: geometry.size.height)
                        .clipped()
                        .zIndex(1)
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
    private var toolbar: XgentNode? { layout?.children?.first { $0.kind == .hStack } }
    private var toolbarChildren: [XgentNode] { toolbar?.children ?? [] }
    private var toolbarTitle: String {
        toolbarChildren.first { $0.kind == .heading }?.text ?? document.title
    }
    private var toolbarSpacerIndex: Int {
        toolbarChildren.firstIndex { $0.kind == .spacer } ?? toolbarChildren.endIndex
    }
    private var leadingToolbarNodes: [XgentNode] {
        toolbarChildren[..<toolbarSpacerIndex].filter { $0.kind != .heading && $0.kind != .badge }
    }
    private var trailingToolbarNodes: [XgentNode] {
        let status = toolbarChildren.filter { $0.kind == .badge }
        let actions = toolbarSpacerIndex < toolbarChildren.endIndex
            ? toolbarChildren[(toolbarSpacerIndex + 1)...].filter { $0.kind != .heading }
            : []
        return status + actions
    }
    private var contentNodes: [XgentNode] {
        (layout?.children ?? []).filter { $0.id != toolbar?.id }
    }

    @ToolbarContentBuilder private var workspaceToolbar: some ToolbarContent {
        if !leadingToolbarNodes.isEmpty {
            ToolbarItemGroup(placement: .topBarLeading) {
                ForEach(leadingToolbarNodes) { node in
                    XgentIOSWorkspaceToolbarControl(node: node, document: document, model: model)
                }
            }
        }
        if !trailingToolbarNodes.isEmpty {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ForEach(trailingToolbarNodes) { node in
                    XgentIOSWorkspaceToolbarControl(node: node, document: document, model: model)
                }
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ForEach(contentNodes) { child in
                    XgentIOSNode(node: child, document: document, model: model)
                }
            }
            .navigationTitle(toolbarTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { workspaceToolbar }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { XgentThemeBackground().ignoresSafeArea() }
        .accessibilityIdentifier("xgent-native-root")
    }
}

// A native compact root never falls back to the generated application-layout
// recursion. New root surfaces get standard iOS navigation and scrolling until
// they define a dedicated handwritten composition above.
struct XgentIOSPagePresentation: View {
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    XgentIOSNodes(nodes: document.nodes, document: document, model: model)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(document.title)
            .navigationBarTitleDisplayMode(.inline)
        }
        .background { XgentThemeBackground().ignoresSafeArea() }
        .accessibilityIdentifier("xgent-native-root")
    }
}

private struct XgentIOSChatPresentation: View {
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    private var chat: XgentNode? { document.nodes.first { $0.kind == .chatLayout } }
    private var toolbar: XgentNode? { chat?.child(id: "toolbar") }
    private var sidebarControl: XgentNode? { toolbar?.child(id: "sidebar") }
    private var toolsControl: XgentNode? { toolbar?.child(id: "tools") }
    private var transcript: XgentNode? { chat?.child(id: "transcript") }
    private var composer: XgentNode? { chat?.child(id: "composer") }
    private var inlineNodes: [XgentNode] {
        (chat?.children ?? []).filter { !["toolbar", "transcript", "composer"].contains($0.id) }
    }

    @ToolbarContentBuilder private var chatToolbar: some ToolbarContent {
        if let sidebarControl {
            ToolbarItem(placement: .topBarLeading) {
                XgentIOSNode(node: sidebarControl, document: document, model: model)
            }
        }
        if let toolsControl {
            ToolbarItem(placement: .topBarTrailing) {
                XgentIOSNode(node: toolsControl, document: document, model: model)
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !inlineNodes.isEmpty {
                    VStack(spacing: 8) {
                        XgentIOSNodes(nodes: inlineNodes, document: document, model: model)
                    }
                    .padding(.horizontal, 12)
                }
                if let transcript {
                    XgentIOSTranscript(node: transcript, document: document, model: model)
                } else {
                    Spacer(minLength: 0)
                }
            }
            .toolbar { chatToolbar }
            .toolbarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let composer { XgentIOSComposer(node: composer, document: document, model: model) }
            }
            .background { XgentThemeBackground().ignoresSafeArea() }
        }
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

private struct XgentIOSComposer: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    private var activity: XgentNode? { node.child(id: "activity-strip") }
    private var input: XgentNode? { node.child(id: "draft") }
    private var actions: XgentNode? { node.child(id: "composer-actions") }
    private var supporting: [XgentNode] {
        (node.children ?? []).filter {
            !["activity-strip", "draft", "composer-actions"].contains($0.id)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let activity {
                HStack(spacing: 8) {
                    XgentIOSNodes(nodes: activity.children ?? [], document: document, model: model)
                }
            }
            if let input { XgentIOSNode(node: input, document: document, model: model) }
            if !supporting.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        XgentIOSNodes(nodes: supporting, document: document, model: model)
                    }
                }
            }
            if let actions {
                HStack(spacing: 6) {
                    XgentIOSNodes(nodes: actions.children ?? [], document: document, model: model)
                }
            }
        }
        .padding(12)
        .modifier(XgentGlassSurface(radius: 26, floating: true))
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
            VStack(alignment: .leading, spacing: 12) {
                if let title { XgentIOSNode(node: title, document: document, model: model) }
                HStack(spacing: 8) {
                    if let mode {
                        XgentIOSNode(node: mode, document: document, model: model)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if let searchToggle {
                        XgentIOSNode(node: searchToggle, document: document, model: model)
                    }
                }
                if let search { XgentIOSNode(node: search, document: document, model: model) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
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
        }
        .safeAreaBar(edge: .bottom, spacing: 0) {
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
                        .background(Color(xgentHex: palette.accent), in: RoundedRectangle(
                            cornerRadius: 12, style: .continuous
                        ))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(newChat.accessibilityLabel ?? newChat.label ?? "")
            }
            if let settings {
                Button { model.send(settings, in: document) } label: {
                    Image(systemName: settings.icon ?? "gearshape")
                        .font(.system(size: 18, weight: .medium))
                        .frame(width: 44, height: 44)
                        .background(Color(xgentHex: palette.surface), in: Circle())
                        .overlay(Circle().stroke(Color(xgentHex: palette.border), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(settings.label ?? "")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

private struct XgentIOSWorkspaceToolbarControl: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    @ViewBuilder var body: some View {
        if node.kind == .button || node.kind == .iconButton {
            Button(role: node.destructive == true ? .destructive : nil) {
                model.send(node, in: document)
            } label: {
                if model.isBusy(node, in: document) {
                    ProgressView()
                } else if let icon = node.icon {
                    Image(systemName: icon)
                } else {
                    Text(node.label ?? "")
                }
            }
            .disabled(node.disabled == true || model.isBusy(node, in: document))
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        } else {
            XgentIOSNode(node: node, document: document, model: model)
        }
    }
}

struct XgentIOSSheetPresentation: View {
    let initialDocument: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    private var document: XgentDocument {
        model.documents.first { $0.id == initialDocument.id } ?? initialDocument
    }
    private var nextSheet: XgentDocument? {
        let sheets = model.documents.filter { $0.mode == .sheet }
        guard let index = sheets.firstIndex(where: { $0.id == document.id }),
              index + 1 < sheets.count else { return nil }
        return sheets[index + 1]
    }
    private var back: XgentNode? { document.nodes.first { $0.id == "back" } }
    private var saveStatus: XgentNode? { document.nodes.first { $0.id == "save-status" } }
    private var visibleNodes: [XgentNode] {
        document.nodes.filter { !["back", "save-status"].contains($0.id) }
    }
    private var grouped: Bool { visibleNodes.contains { $0.kind == .settingsGroup } }
    private var list: XgentNode? {
        visibleNodes.count == 1 && visibleNodes.first?.kind == .list ? visibleNodes.first : nil
    }

    @ViewBuilder private var content: some View {
        if grouped {
            Form {
                XgentIOSNodes(nodes: visibleNodes, document: document, model: model)
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        } else if let list {
            List {
                ForEach(list.children ?? []) { child in
                    XgentIOSNode(node: child, document: document, model: model)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    XgentIOSNodes(nodes: visibleNodes, document: document, model: model)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    @ToolbarContentBuilder private var sheetToolbar: some ToolbarContent {
        if let back {
            ToolbarItem(placement: .cancellationAction) {
                Button { model.send(back, in: document) } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(back.label ?? "Back")
            }
        }
        if let saveStatus, back != nil {
            ToolbarItem(placement: .confirmationAction) {
                Text(saveStatus.text ?? "")
                    .font(.subheadline)
                    .foregroundStyle(saveStatus.secondary == true ? Color.secondary : Color.red)
            }
        } else if document.dismissAction != nil {
            ToolbarItem(placement: .confirmationAction) {
                Button { model.dismiss(document) } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Close"))
            }
        }
    }

    private var nestedSheet: Binding<XgentDocument?> {
        Binding(get: { nextSheet }, set: {
            if $0 == nil, let nextSheet { model.dismiss(nextSheet) }
        })
    }

    private var navigation: some View {
        NavigationStack {
            content
                .background(Color.clear)
                .navigationTitle(document.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { sheetToolbar }
        }
    }

    var body: some View {
        navigation
        .presentationDetents(grouped ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
        .preferredColorScheme(document.colorScheme)
        .interactiveDismissDisabled(document.dismissAction == nil)
        .sheet(item: nestedSheet) { next in
            XgentIOSSheetPresentation(initialDocument: next, model: model)
        }
        .modifier(XgentAlerts(model: model, enabled: nextSheet == nil))
        .modifier(XgentPresentationThemeModifier(theme: document.theme ?? .fallback,
                                                  appearance: document.appearance))
    }
}
#endif
