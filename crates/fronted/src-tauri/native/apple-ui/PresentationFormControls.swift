import SwiftUI

struct XgentTextInput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentSettingsRow) private var isFormRow
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if os(iOS)
    @Environment(\.xgentSettingsFieldHeader) private var hasSectionLabel
    #endif
    @State private var secretFocused = false
    @FocusState private var focused: Bool
    @State private var hasDraft = false

    private var value: Binding<String> {
        Binding(get: { model.value(node, in: document).text },
                set: {
                    hasDraft = true
                    model.send(node, in: document, value: .string($0), editing: true)
                })
    }

    private func commit() {
        guard hasDraft, node.commitAction != nil else { return }
        hasDraft = false
        model.send(node, in: document, value: .string(value.wrappedValue), editing: true, committing: true)
    }

    @ViewBuilder private var entry: some View {
        #if os(iOS)
        XgentIOSSingleLineField(text: value, focused: $secretFocused, node: node, commit: commit)
        #else
        if node.secure == true {
            SecureField(node.text ?? "", text: value).focused($focused)
        }
        else { TextField(node.text ?? "", text: value).focused($focused) }
        #endif
    }

    @ViewBuilder private var accessibleEntry: some View {
        #if os(iOS)
        // UIKit owns the interactive element's identifier and traits.
        entry
        #else
        entry.accessibilityIdentifier(node.id)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        #endif
    }

    private var field: some View {
        accessibleEntry
                .textFieldStyle(.plain)
                .onSubmit(commit)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(node.variant == "integer-input" ? .numberPad :
                    node.variant == "decimal-input" ? .decimalPad : .default)
                #endif
    }

    @ViewBuilder private var layout: some View {
        #if os(iOS)
        if isFormRow {
            if node.variant == "settings-stacked-field" {
                settingsField
            } else if hasSectionLabel {
                field.modifier(XgentControlTypography(node: node))
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            } else if node.secure != true && !dynamicTypeSize.isAccessibilitySize {
                XgentSettingsValueRow(node: node, showsDescription: false) {
                    field
                        .modifier(XgentControlTypography(node: node))
                        .multilineTextAlignment(.trailing)
                        .frame(width: 140)
                        .frame(minHeight: 44)
                }
            } else { settingsField }
        } else {
            labeledField
        }
        #else
        labeledField
        #endif
    }

    private var settingsField: some View {
        VStack(alignment: .leading, spacing: 6) {
            XgentFieldLabel(node: node)
            field
                .modifier(XgentControlTypography(node: node))
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
    }

    private var labeledField: some View {
        VStack(alignment: .leading, spacing: 8) {
            XgentFieldLabel(node: node)
            field.modifier(XgentFieldSurface(node: node, active: focused || secretFocused))
        }
    }

    var body: some View {
        layout
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .disabled(node.disabled == true)
        .onChange(of: focused) { wasFocused, isFocused in
            if wasFocused && !isFocused { commit() }
        }
        .onChange(of: node.action) { _, _ in hasDraft = false }
        .onChange(of: node.commitAction) { _, _ in hasDraft = false }
    }
}

struct XgentSelector: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    var showsLabel = true
    @Environment(\.xgentSettingsRow) private var isSettingsRow
    @State private var pickerOpen = false

    private var isStacked: Bool { node.variant == "searchable-stacked-selector" }
    private var usesValueRow: Bool { isSettingsRow && !isStacked }

    private var selectedLabel: String {
        node.options?.first { $0.value == model.value(node, in: document).text }?.label ?? node.text ?? ""
    }

    private var selectionLabel: some View {
        HStack(spacing: 8) {
            if node.variant == "composer-command-safety" {
                Image(systemName: node.icon ?? "shield").accessibilityHidden(true)
            } else if isStacked, let icon = node.icon {
                Image(systemName: icon).frame(width: 16).accessibilityHidden(true)
            }
            Text(selectedLabel).fixedSize(horizontal: false, vertical: true)
            if !usesValueRow && !["composer-command-safety", "sidebar-work-mode"].contains(node.variant ?? "") { Spacer(minLength: 8) }
            Image(systemName: "chevron.up.chevron.down").font(.caption).accessibilityHidden(true)
        }
        .modifier(XgentSelectorSurface(node: node, isSettingsRow: usesValueRow))
        .environment(\.xgentSettingsRow, usesValueRow)
    }

    @ViewBuilder private var control: some View {
        if ["searchable-selector", "searchable-stacked-selector"].contains(node.variant ?? "") {
            Button { pickerOpen = true } label: { selectionLabel }
                .modifier(XgentSelectionPresentation(node: node, document: document, model: model, isPresented: $pickerOpen))
        } else { menu }
    }

    private var menu: some View {
        Menu {
                ForEach(node.options ?? []) { option in
                    Button {
                        model.send(node, in: document, value: .string(option.value), editing: true)
                    } label: {
                        if option.value == model.value(node, in: document).text {
                            Label(option.label, systemImage: "checkmark")
                        } else { Text(option.label) }
                    }
                    .disabled(option.disabled == true)
                }
            } label: {
                selectionLabel
            }
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .buttonStyle(.plain)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            .accessibilityValue(selectedLabel)
            .accessibilityHint(node.accessibilityHint ?? node.text ?? "")
            .accessibilityActivationPoint(.center)
    }

    var body: some View {
        Group {
            if usesValueRow && showsLabel {
                XgentSettingsValueRow(node: node) { accessibleControl }
            } else if ["composer-command-safety", "sidebar-work-mode"].contains(node.variant ?? "") {
                accessibleControl
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    if showsLabel { XgentFieldLabel(node: node) }
                    accessibleControl
                }
            }
        }
        .disabled(node.disabled == true)
    }

    private var accessibleControl: some View {
        control.buttonStyle(.plain)
            .accessibilityIdentifier(node.id)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            .accessibilityValue(selectedLabel)
            .accessibilityHint(node.accessibilityHint ?? node.text ?? "")
    }
}

private struct XgentSelectorSurface: ViewModifier {
    let node: XgentNode
    let isSettingsRow: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if node.variant == "sidebar-work-mode" {
            content.font(.title2.weight(.bold)).foregroundStyle(.primary)
                .frame(minHeight: 44).contentShape(Rectangle())
        } else if node.variant == "composer-command-safety" {
            content.font(.subheadline).foregroundStyle(.secondary)
                .frame(minHeight: 44).contentShape(Rectangle())
        } else {
        #if os(iOS)
        if isSettingsRow {
            content
                .modifier(XgentControlTypography(node: node))
                .foregroundStyle(.secondary)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        } else { content.modifier(XgentFieldSurface(node: node)) }
        #else
        content.modifier(XgentFieldSurface(node: node))
        #endif
        }
    }
}

struct XgentSwitch: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .subheadline) private var supportingScale = 1.0

    private var value: Binding<Bool> {
        Binding(
            get: { model.value(node, in: document).boolean },
            set: { model.send(node, in: document, value: .bool($0), editing: true) }
        )
    }

    private var label: some View {
        HStack(spacing: 10) {
            if let icon = node.icon {
                Image(systemName: icon).frame(width: 24).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(node.label ?? "").fixedSize(horizontal: false, vertical: true)
                if let text = node.text, !text.isEmpty {
                    Text(text)
                        .font(XgentFonts.body(theme.fontFamily,
                            size: CGFloat(theme.typography.supporting * theme.fontScale) * supportingScale))
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    var body: some View {
        Group {
        #if os(iOS)
        HStack(spacing: 12) {
            label
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { value.wrappedValue.toggle() }
                .accessibilityHidden(true)
            Toggle(node.accessibilityLabel ?? node.label ?? "", isOn: value)
                .labelsHidden()
                .toggleStyle(.switch)
                .tint(Color(uiColor: .systemGreen))
                .frame(minHeight: 44)
                .accessibilityIdentifier(node.id)
                .accessibilityHint(node.accessibilityHint ?? node.text ?? "")
                .fixedSize(horizontal: true, vertical: false)
        }
        .accessibilityElement(children: .contain)
        #else
        Toggle(isOn: value) { label }
        .toggleStyle(.switch)
        .accessibilityIdentifier(node.id)
        #endif
        }
        .modifier(XgentControlTypography(node: node))
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .disabled(node.disabled == true)
    }
}

struct XgentSegmentedControl: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var picker: some View {
        Picker(node.label ?? "", selection: Binding(
            get: { model.value(node, in: document).text },
            set: { model.send(node, in: document, value: .string($0), editing: true) }
        )) {
            ForEach(node.options ?? []) { option in
                Text(option.label).tag(option.value).disabled(option.disabled == true)
            }
        }
        .labelsHidden()
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            XgentFieldLabel(node: node)
            if dynamicTypeSize.isAccessibilitySize {
                XgentSelector(node: node, document: document, model: model, showsLabel: false)
            } else {
                ViewThatFits(in: .horizontal) {
                    picker.pickerStyle(.segmented).fixedSize(horizontal: true, vertical: false)
                    XgentSelector(node: node, document: document, model: model, showsLabel: false)
                }
                .modifier(XgentControlTypography(node: node))
            }
        }
        .disabled(node.disabled == true)
    }
}
