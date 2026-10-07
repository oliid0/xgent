import SwiftUI
#if os(macOS)
import AppKit
#endif

struct XgentBrowserLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var focusRequest = 0

    private var hasStartTools: Bool {
        (node.children ?? []).contains { item in
            item.variant == "browser-empty" && (item.children ?? []).contains { $0.variant == "browser-new-tab-tools" }
        }
    }

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(node.children ?? []) { item in
                if hasStartTools && item.variant == "browser-error" {
                    // Error details scroll with the start page so large text
                    // cannot consume the tool viewport below the address bar.
                } else if item.variant == "browser-empty" {
                    if hasStartTools {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 12) {
                                ForEach((node.children ?? []).filter { $0.variant == "browser-error" }) { content($0) }
                                ForEach(item.children ?? []) { content($0) }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        VStack { Spacer(minLength: 0); content(item); Spacer(minLength: 0) }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                } else { content(item) }
                if item.variant == "browser-navigation" { Divider() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .environment(\.xgentBrowserAddressFocusRequest, focusRequest)
        .environment(\.xgentSettingsRow, false)
        #if os(macOS)
        .background {
            if node.id == "browser-layout" {
                HStack {
                    Button { focusRequest += 1 } label: { EmptyView() }
                        .keyboardShortcut("l", modifiers: .command)
                    shortcut("browser-new", key: "t", modifiers: .command)
                    shortcut("browser-close-tab", key: "w", modifiers: .command)
                    shortcut("browser-reload", key: "r", modifiers: .command)
                    if document.mode == .panel {
                        Button {
                            guard model.workspaceState.visible, model.workspaceState.selectedSurface == document.surface else { return }
                            model.workspaceState.expanded.toggle()
                        } label: { EmptyView() }
                        .keyboardShortcut(KeyEquivalent(Character(String(UnicodeScalar(Int(NSEvent.SpecialKey.f11.rawValue))!))), modifiers: [])
                    }
                    shortcut("browser-devtools", key: KeyEquivalent(Character(String(UnicodeScalar(Int(NSEvent.SpecialKey.f12.rawValue))!))), modifiers: [])
                }.frame(width: 0, height: 0).clipped().accessibilityHidden(true)
            }
        }
        #endif
    }

    #if os(macOS)
    @ViewBuilder private func shortcut(_ id: String, key: KeyEquivalent, modifiers: EventModifiers) -> some View {
        if let item = document.node(id: id) {
            Button { model.send(item, in: document) } label: { EmptyView() }
                .keyboardShortcut(key, modifiers: modifiers)
                .disabled(item.disabled == true || model.isBusy(item, in: document))
        }
    }
    #endif
}
