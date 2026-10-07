#if os(macOS)
import AppKit
import Combine
import SwiftUI

/// AppKit owns window dragging, traffic lights and toolbar overflow. SwiftUI
/// renders the title and tabs; shared presentation actions own their behavior.
@MainActor
final class XgentDesktopWindowChrome: NSObject, NSToolbarDelegate {
    private let model: XgentPresentationModel
    private weak var window: NSWindow?
    private var originalToolbar: NSToolbar?
    private var originalStyle: NSWindow.ToolbarStyle = .automatic
    private var originalTitleVisibility: NSWindow.TitleVisibility = .visible
    private var originalTransparent = false
    private var originalSeparator: NSTitlebarSeparatorStyle = .automatic
    private var originalTitle = ""
    private var originalAppearance: NSAppearance?
    private var toolbar: NSToolbar?
    private var buttons: [String: NSButton] = [:]
    private var titleWidth: NSLayoutConstraint?
    private var observation: AnyCancellable?
    private var refreshScheduled = false
    private let identifiers = ["back", "forward", "left", "title", "right"]
    private var context: XgentWindowToolbarContext { XgentWindowToolbarContext(model: model) }

    init(model: XgentPresentationModel) {
        self.model = model
        super.init()
        observation = model.objectWillChange.sink { [weak self] _ in
            self?.scheduleRefresh()
        }
    }

    func install(on window: NSWindow) {
        if self.window === window, window.toolbar === toolbar { refresh(); return }
        detach()
        self.window = window
        originalToolbar = window.toolbar
        originalStyle = window.toolbarStyle
        originalTitleVisibility = window.titleVisibility
        originalTransparent = window.titlebarAppearsTransparent
        originalSeparator = window.titlebarSeparatorStyle
        originalTitle = window.title
        originalAppearance = window.appearance
        let toolbar = NSToolbar(identifier: "xgent.native.window-toolbar")
        self.toolbar = toolbar
        toolbar.delegate = self
        toolbar.allowsUserCustomization = false
        toolbar.autosavesConfiguration = false
        toolbar.displayMode = .iconOnly
        toolbar.showsBaselineSeparator = false
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.toolbarStyle = .unified
        window.toolbar = toolbar
        model.windowChromeInstalled = true
        for name in [NSWindow.didResizeNotification, NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification] {
            NotificationCenter.default.addObserver(self, selector: #selector(windowChanged), name: name, object: window)
        }
        refresh()
    }

    func detach() {
        if let window {
            NotificationCenter.default.removeObserver(self, name: nil, object: window)
            if window.toolbar === toolbar {
                window.toolbar = originalToolbar
                window.toolbarStyle = originalStyle
                window.titleVisibility = originalTitleVisibility
                window.titlebarAppearsTransparent = originalTransparent
                window.titlebarSeparatorStyle = originalSeparator
                window.title = originalTitle
                window.appearance = originalAppearance
            }
        }
        window = nil
        toolbar = nil
        originalToolbar = nil
        originalAppearance = nil
        buttons.removeAll()
        titleWidth = nil
        if model.windowChromeInstalled { model.windowChromeInstalled = false }
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [itemID("back"), itemID("forward"), itemID("left"), .flexibleSpace, itemID("title"), .flexibleSpace, itemID("right")]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        identifiers.map(itemID) + [.flexibleSpace]
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard let name = identifiers.first(where: { itemID($0) == identifier }) else { return nil }
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.isBordered = false
        if name == "title" {
            let view = NSHostingView(rootView: XgentWindowToolbarTitle(model: model))
            view.sizingOptions = []
            view.translatesAutoresizingMaskIntoConstraints = false
            let width = view.widthAnchor.constraint(equalToConstant: 180)
            width.priority = .defaultLow
            NSLayoutConstraint.activate([width, view.widthAnchor.constraint(greaterThanOrEqualToConstant: 32),
                                         view.heightAnchor.constraint(equalToConstant: 44)])
            titleWidth = width
            item.view = view
            item.visibilityPriority = .low
        } else {
            let button = NSButton(image: NSImage(systemSymbolName: symbol(name), accessibilityDescription: nil) ?? NSImage(),
                                  target: self, action: #selector(activate(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(name)
            button.setAccessibilityIdentifier("xgent-window-\(name)")
            button.bezelStyle = .texturedRounded
            button.isBordered = false
            button.imagePosition = .imageOnly
            button.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([button.widthAnchor.constraint(equalToConstant: 32),
                                         button.heightAnchor.constraint(equalToConstant: 32)])
            buttons[name] = button
            item.view = button
            item.visibilityPriority = .high
        }
        let menu = NSMenuItem(title: "", action: #selector(activateMenu(_:)), keyEquivalent: "")
        menu.target = self
        menu.representedObject = name
        item.menuFormRepresentation = menu
        return item
    }

    private func itemID(_ name: String) -> NSToolbarItem.Identifier { .init("xgent.window.\(name)") }
    private func symbol(_ name: String) -> String {
        switch name {
        case "back": return "arrow.left"
        case "forward": return "arrow.right"
        case "left": return "sidebar.leading"
        default: return "sidebar.trailing"
        }
    }
    private func node(_ name: String) -> XgentNode? {
        switch name {
        case "back": return context.back
        case "forward": return context.forward
        case "left": return context.left
        case "right": return context.right
        default: return nil
        }
    }
    private func document(_ name: String) -> XgentDocument? {
        name == "back" || name == "forward" ? context.navigation : context.root
    }
    private func enabled(_ name: String) -> Bool {
        if context.overlay != nil, name != "back" { return false }
        if name == "left", let sidebar = context.sidebar { return !model.isDismissing(sidebar) }
        if name == "right", !context.panels.isEmpty { return true }
        guard let node = node(name), let document = document(name) else { return false }
        return node.disabled != true && !model.isBusy(node, in: document)
    }
    @objc private func windowChanged() { refresh() }
    private func scheduleRefresh() {
        guard !refreshScheduled else { return }
        refreshScheduled = true
        DispatchQueue.main.async { [weak self] in
            self?.refreshScheduled = false
            self?.refresh()
        }
    }
    private func refresh() {
        guard let window, window.toolbar === toolbar else { return }
        // AppKit keeps essential controls visible and moves low priority content
        // to its native overflow menu when even the compact title cannot fit.
        titleWidth?.constant = min(640, max(32, window.frame.width - 300))
        if window.title != context.selectedTitle { window.title = context.selectedTitle }
        let appearance: NSAppearance?
        switch context.root?.appearance {
        case .some(.light): appearance = NSAppearance(named: .aqua)
        case .some(.dark): appearance = NSAppearance(named: .darkAqua)
        default: appearance = nil
        }
        if window.appearance?.name != appearance?.name { window.appearance = appearance }
        for item in toolbar?.items ?? [] {
            guard let name = identifiers.first(where: { itemID($0) == item.itemIdentifier }) else { continue }
            let label: String
            if name == "title" { label = context.selectedTitle }
            else if name == "left", let sidebar = context.sidebar { label = sidebar.node(id: "sidebar-close")?.label ?? node(name)?.label ?? sidebar.title }
            else if name == "right", let panel = context.panels.first(where: { $0.surface == model.workspaceState.selectedSurface }) ?? context.panels.last {
                label = (model.workspaceState.visible ? panel.workspacePanel?.closeLabel : panel.workspacePanel?.openLabel) ?? node(name)?.label ?? panel.title
            } else { label = node(name)?.label ?? (name == "back" ? "Back" : name == "forward" ? "Forward" : context.root?.title ?? "Xgent") }
            item.label = label
            item.paletteLabel = label
            item.toolTip = label
            item.menuFormRepresentation?.title = label
            item.menuFormRepresentation?.isEnabled = name == "title" || enabled(name)
            if name == "title" {
                let menu = NSMenu()
                if let root = context.root {
                    let entry = NSMenuItem(title: root.title, action: #selector(activateMenu(_:)), keyEquivalent: "")
                    entry.target = self
                    entry.representedObject = "return-chat"
                    entry.isEnabled = context.selectedPanel != nil
                    menu.addItem(entry)
                }
                for tab in context.tabs {
                    let entry = NSMenuItem(title: tab.subtitle.isEmpty ? tab.title : "\(tab.title) — \(tab.subtitle)",
                                           action: #selector(activateMenu(_:)), keyEquivalent: "")
                    entry.target = self
                    entry.representedObject = "tab:\(tab.id)"
                    entry.state = tab.selected ? .on : .off
                    entry.isEnabled = tab.action?.disabled != true
                    menu.addItem(entry)
                }
                if let panel = context.selectedPanel {
                    let entry = NSMenuItem(title: context.closeAction?.node.label ?? panel.workspacePanel?.closeTabLabel ?? panel.workspacePanel?.closeLabel ?? panel.title,
                                           action: #selector(activateMenu(_:)), keyEquivalent: "")
                    entry.target = self
                    entry.representedObject = "close-selected-tab"
                    entry.isEnabled = context.closeAction.map { $0.node.disabled != true && !model.isBusy($0.node, in: $0.document) } ?? !model.isDismissing(panel)
                    menu.addItem(entry)
                }
                if let tools = context.root?.node(id: "tools") {
                    let entry = NSMenuItem(title: tools.label ?? "", action: #selector(activateMenu(_:)), keyEquivalent: "")
                    entry.target = self
                    entry.representedObject = "tools"
                    menu.addItem(entry)
                }
                menu.autoenablesItems = false
                item.menuFormRepresentation?.submenu = menu
            }
            if let button = buttons[name] {
                button.toolTip = label
                button.setAccessibilityLabel(label)
                button.isEnabled = enabled(name)
                let selected = name == "left" ? context.sidebar != nil : name == "right" && context.selectedPanel != nil
                button.contentTintColor = selected ? .labelColor : .secondaryLabelColor
                button.setAccessibilityValue(selected ? "1" : "0")
            }
        }
    }
    @objc private func activate(_ sender: NSButton) { run(sender.identifier?.rawValue ?? "") }
    @objc private func activateMenu(_ sender: NSMenuItem) { run(sender.representedObject as? String ?? "") }
    private func run(_ name: String) {
        guard window?.toolbar === toolbar else { return }
        if name == "return-chat", context.supportsPanels { model.workspaceState.visible = false; return }
        if name == "close-selected-tab" { context.closeSelectedTab(); return }
        if name.hasPrefix("tab:"), let tab = context.tabs.first(where: { "tab:\($0.id)" == name }) {
            tab.select(model)
            return
        }
        if name == "tools", context.overlay == nil, let root = context.root, let tools = root.node(id: "tools") {
            model.send(tools, in: root)
            return
        }
        guard enabled(name) else { return }
        if name == "left", let sidebar = context.sidebar { model.dismiss(sidebar) }
        else if name == "right", !context.panels.isEmpty { model.workspaceState.visible.toggle() }
        else if let node = node(name), let document = document(name) { model.send(node, in: document) }
    }
}
#endif
