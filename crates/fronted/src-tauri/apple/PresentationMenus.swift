import SwiftUI

// Menu content uses native menu semantics, not form/button styling inside the popup.
struct XgentNativeMenu: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var iconOnly: Bool { node.variant == "compact" || node.variant == "secondary" || node.id == "tools" }

    var body: some View {
        Menu {
            XgentNativeMenuItems(nodes: node.children ?? [], document: document, model: model)
        } label: {
            if iconOnly { XgentControlIcon(name: node.icon ?? "ellipsis") }
            else {
                HStack(spacing: 8) {
                    if let icon = node.icon { XgentControlIcon(name: icon) }
                    Text(node.label ?? "").fixedSize(horizontal: false, vertical: true)
                        .lineLimit(node.id == "sidebar-soul-menu" ? 1 : nil)
                }
            }
        }
        .menuStyle(.button)
        .menuIndicator(node.id == "sidebar-soul-menu" ? .visible : .hidden)
        .buttonStyle(XgentActionButtonStyle(node: node, iconOnly: iconOnly))
        .disabled(node.disabled == true)
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        .accessibilityActivationPoint(.center)
    }
}

struct XgentNativeMenuItems: View {
    let nodes: [XgentNode]
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        ForEach(nodes) { child in
            switch child.kind {
            case .divider:
                Divider()
            case .menu:
                Menu {
                    AnyView(XgentNativeMenuItems(nodes: child.children ?? [], document: document, model: model))
                } label: {
                    Label(child.label ?? "", systemImage: child.icon ?? "ellipsis")
                }
                .disabled(child.disabled == true)
            case .section, .settingsGroup:
                Section {
                    AnyView(XgentNativeMenuItems(nodes: child.children ?? [], document: document, model: model))
                } header: {
                    if let label = child.label, !label.isEmpty { Text(label) }
                }
            case .toggle:
                Toggle(isOn: Binding(
                    get: { model.value(child, in: document).boolean },
                    set: { model.send(child, in: document, value: .bool($0), editing: true) }
                )) {
                    if let icon = child.icon { Label(child.label ?? "", systemImage: icon) }
                    else { Text(child.label ?? "") }
                }
                .disabled(child.disabled == true)
            case .selector, .segmentedControl:
                Picker(child.label ?? "", selection: Binding(
                    get: { model.value(child, in: document).text },
                    set: { model.send(child, in: document, value: .string($0), editing: true) }
                )) {
                    ForEach(child.options ?? []) { option in
                        Text(option.label).tag(option.value).disabled(option.disabled == true)
                    }
                }
                .pickerStyle(.inline)
                .disabled(child.disabled == true)
            case .heading, .text, .badge:
                Text(child.label ?? child.text ?? "")
            default:
                Button(role: child.destructive == true ? .destructive : nil) {
                    model.send(child, in: document)
                } label: {
                    if child.selected == true {
                        Label(child.label ?? "", systemImage: "checkmark")
                    } else if let icon = child.icon {
                        Label(child.label ?? "", systemImage: icon)
                    } else { Text(child.label ?? child.text ?? "") }
                }
                .disabled(child.action == nil || child.disabled == true || model.isBusy(child, in: document))
            }
        }
    }
}
