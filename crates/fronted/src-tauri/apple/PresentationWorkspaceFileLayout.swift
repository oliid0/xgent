import SwiftUI

struct XgentWorkspaceFileLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        VStack(spacing: 0) {
            ForEach((node.children ?? []).filter { $0.variant != "workspace-code-find-action" }) { item in
                #if os(iOS)
                XgentIOSNode(node: item, document: document, model: model)
                #else
                XgentNodeView(node: item, document: document, model: model)
                #endif
                if item.id == "workspace-file-toolbar" || item.id == "workspace-file-sheets" || item.id == "workspace-editor-tabs" { Divider() }
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
        .environment(\.xgentSettingsRow, false)
        #if os(macOS)
        .background {
            HStack {
                shortcut("workspace-file-save", key: "s")
                shortcut("workspace-file-close", key: "w")
                shortcut("workspace-file-save-all", key: "s", modifiers: [.command, .shift])
                shortcut("workspace-file-close-all", key: "w", modifiers: [.command, .shift])
            }.frame(width: 0, height: 0).clipped().accessibilityHidden(true)
        }
        #endif
    }

    #if os(macOS)
    @ViewBuilder private func shortcut(_ id: String, key: KeyEquivalent, modifiers: EventModifiers = .command) -> some View {
        if let item = document.node(id: id) {
            Button {
                model.codeHosts.commit(in: document)
                if item.variant == "workspace-editor-bulk-action" {
                    XgentWorkspaceBulkAction.send(item, document: document, model: model); return
                }
                if item.variant == "workspace-source-action" {
                    guard let draft = XgentWorkspaceSourceDraft.current(for: item, in: document, model: model),
                          (id != "workspace-file-save" || draft.dirty), let value = draft.encoded else { return }
                    model.send(item, in: document, value: .string(value)); return
                }
                if item.variant == "workspace-image-save" {
                    guard let angle = XgentImageRotationDraft.angle(in: document, model: model),
                          (XgentImageRotationDraft.relative(in: document, model: model) ?? 0) != 0 else { return }
                    model.send(item, in: document, value: .number(angle)); return
                }
                model.send(item, in: document)
            } label: { EmptyView() }
                .keyboardShortcut(key, modifiers: modifiers)
                .disabled(item.disabled == true || model.isBusy(item, in: document))
        }
    }
    #endif
}
