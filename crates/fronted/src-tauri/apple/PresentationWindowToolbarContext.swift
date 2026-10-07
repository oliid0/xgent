#if os(macOS)
import SwiftUI

struct XgentWindowToolbarTab: Identifiable {
    let document: XgentDocument
    let id: String
    let title: String
    let subtitle: String
    let selected: Bool
    let action: XgentNode?
    let value: XgentValue
    let editor: Bool

    @MainActor func select(_ model: XgentPresentationModel) {
        guard !model.documents.contains(where: { $0.mode == .sheet || $0.mode == .alert }),
              model.documents.last(where: { $0.mode == .root })?.nodes.contains(where: { $0.kind == .chatLayout }) == true,
              let current = model.documents.first(where: { $0.surface == document.surface }), current.mode == .panel else { return }
        if let action {
            guard let control = current.node(id: action.id), control.action == action.action,
                  control.kind == action.kind, control.disabled != true,
                  !model.isBusy(action, in: current) else { return }
        }
        model.workspaceState.select(document.surface)
        guard let action else { return }
        if editor { XgentWorkspaceTabAction.send(action, document: document, model: model) }
        else { model.send(action, in: document, value: value) }
    }
}

/// Window chrome reads the same documents and actions as the content panes.
@MainActor
struct XgentWindowToolbarContext {
    let model: XgentPresentationModel
    var root: XgentDocument? { model.documents.last { $0.mode == .root } }
    var overlay: XgentDocument? { model.documents.last { $0.mode == .sheet || $0.mode == .alert } }
    var titleDocument: XgentDocument? { overlay ?? root }
    var supportsPanels: Bool { overlay == nil && root?.nodes.contains { $0.kind == .chatLayout } == true }
    var panels: [XgentDocument] { supportsPanels ? model.documents.filter { $0.mode == .panel && $0.surface != model.workspaceState.dockedSurface } : [] }
    var selectedPanel: XgentDocument? {
        guard model.workspaceState.visible else { return nil }
        return panels.first { $0.surface == model.workspaceState.selectedSurface } ?? panels.last
    }
    var sidebar: XgentDocument? { model.documents.last { $0.mode == .sidebar } }
    var navigation: XgentDocument? {
        if let overlay { return overlay }
        if let panel = selectedPanel, panel.node(id: "browser-navigation") != nil { return panel }
        return root
    }
    var back: XgentNode? {
        navigation?.node(id: "browser-back") ?? navigation?.node(id: "window-back") ?? navigation?.node(id: "back")
    }
    var forward: XgentNode? {
        navigation?.node(id: "browser-forward") ?? navigation?.node(id: "window-forward")
    }
    var left: XgentNode? {
        root?.node(id: "sidebar") ?? root?.node(id: "open-sidebar")
    }
    var right: XgentNode? { root?.node(id: "window-right-sidebar") }
    var selectedTitle: String {
        if let overlay { return overlay.title }
        return tabs.first { $0.selected }?.title ?? selectedPanel?.title ?? root?.title ?? "Xgent"
    }
    var closeAction: (document: XgentDocument, node: XgentNode, editor: Bool)? {
        guard let panel = selectedPanel else { return nil }
        if let tab = panel.node(id: "workspace-editor-tabs")?.children?.first(where: { $0.selected == true }),
           let close = tab.children?.last, close.id != tab.children?.first?.id {
            return (panel, close, true)
        }
        if let close = panel.node(id: "browser-close-tab") { return (panel, close, false) }
        return nil
    }
    @discardableResult func closeSelectedTab() -> Bool {
        if let close = closeAction {
            guard close.node.disabled != true, !model.isBusy(close.node, in: close.document) else { return false }
            if close.editor { XgentWorkspaceTabAction.send(close.node, document: close.document, model: model) }
            else { model.send(close.node, in: close.document) }
            return true
        }
        guard let panel = selectedPanel, panel.dismissAction != nil, !model.isDismissing(panel) else { return false }
        model.dismiss(panel)
        return true
    }
    var tabs: [XgentWindowToolbarTab] {
        panels.flatMap { document -> [XgentWindowToolbarTab] in
            let selected = document.surface == selectedPanel?.surface
            if let browsers = document.node(id: "browser-tab-items")?.children, !browsers.isEmpty {
                return browsers.map {
                    XgentWindowToolbarTab(document: document, id: "\(document.surface):\($0.id)",
                        title: $0.label ?? document.title, subtitle: $0.text ?? "",
                        selected: selected && $0.selected == true, action: $0, value: .null, editor: false)
                }
            }
            if let editors = document.node(id: "workspace-editor-tabs")?.children, !editors.isEmpty {
                return editors.map {
                    XgentWindowToolbarTab(document: document, id: "\(document.surface):\($0.id)",
                        title: $0.label ?? document.title, subtitle: $0.text ?? "",
                        selected: selected && $0.selected == true, action: $0.children?.first, value: .null, editor: true)
                }
            }
            if let sessions = document.node(id: "terminal-session"), let options = sessions.options, !options.isEmpty {
                return options.map {
                    XgentWindowToolbarTab(document: document, id: "\(document.surface):\($0.value)",
                        title: $0.label, subtitle: document.title,
                        selected: selected && sessions.value?.text == $0.value,
                        action: sessions, value: .string($0.value), editor: false)
                }
            }
            return [XgentWindowToolbarTab(document: document, id: document.surface, title: document.title,
                subtitle: "", selected: selected, action: nil, value: .null, editor: false)]
        }
    }
}
#endif
