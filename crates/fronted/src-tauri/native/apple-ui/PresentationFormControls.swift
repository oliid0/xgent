import SwiftUI

struct XgentTextInput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var secretFocused = false

    private var value: Binding<String> {
        Binding(get: { model.value(node, in: document).text },
                set: { model.send(node, in: document, value: .string($0), editing: true) })
    }

    @ViewBuilder private var entry: some View {
        if node.secure == true {
            #if os(iOS)
            XgentIOSSecretField(text: value, focused: $secretFocused, node: node)
            #else
            SecureField(node.text ?? "", text: value)
            #endif
        }
        else { TextField(node.text ?? "", text: value) }
    }

    @ViewBuilder private var accessibleEntry: some View {
        #if os(iOS)
        if node.secure == true {
            // UIKit owns the secure trait and label. A SwiftUI AX wrapper
            // replaces that native field with a traitless virtual element.
            entry
        } else {
            entry.accessibilityIdentifier(node.id)
                .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        }
        #else
        entry.accessibilityIdentifier(node.id)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            XgentFieldLabel(node: node)
            accessibleEntry
                .textFieldStyle(.plain)
                .modifier(XgentFieldSurface(node: node, active: secretFocused))
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .disabled(node.disabled == true)
    }
}

struct XgentSelector: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    var showsLabel = true

    private var selectedLabel: String {
        node.options?.first { $0.value == model.value(node, in: document).text }?.label ?? node.text ?? ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if showsLabel { XgentFieldLabel(node: node) }
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
                HStack(spacing: 8) {
                    Text(selectedLabel).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down").font(.caption).accessibilityHidden(true)
                }
                .modifier(XgentFieldSurface(node: node))
            }
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .buttonStyle(.plain)
            .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            .accessibilityValue(selectedLabel)
        }
        .disabled(node.disabled == true)
    }
}

struct XgentSwitch: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        Toggle(isOn: Binding(
            get: { model.value(node, in: document).boolean },
            set: { model.send(node, in: document, value: .bool($0), editing: true) }
        )) {
            VStack(alignment: .leading, spacing: 4) {
                Text(node.label ?? "").fixedSize(horizontal: false, vertical: true)
                if let text = node.text, !text.isEmpty {
                    Text(text).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .toggleStyle(.switch)
        .modifier(XgentControlTypography(node: node))
        .frame(minHeight: 44)
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
