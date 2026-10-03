import Foundation
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum XgentHexColor {
    static func normalized(_ value: String) -> String? {
        guard value.utf8.count == 7,
              value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else { return nil }
        return value.lowercased()
    }

    static func value(red: CGFloat, green: CGFloat, blue: CGFloat) -> String? {
        guard red.isFinite, green.isFinite, blue.isFinite else { return nil }
        func channel(_ value: CGFloat) -> Int { Int((min(1, max(0, value)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", channel(red), channel(green), channel(blue))
    }
}

/// The swatch and an editable HEX value share one persisted color action.
/// Partial HEX drafts stay local and never become invalid appearance settings.
struct XgentColorInput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentSettingsRow) private var isSettingsRow
    @State private var draft: String
    @FocusState private var editingHex: Bool

    init(node: XgentNode, document: XgentDocument, model: XgentPresentationModel) {
        self.node = node
        self.document = document
        self.model = model
        _draft = State(initialValue: node.value?.text ?? "#000000")
    }

    private var accepted: String { model.value(node, in: document).text }
    private var valid: Bool { XgentHexColor.normalized(draft) != nil }
    private var color: Binding<Color> {
        Binding(get: { Color(xgentHex: accepted) }, set: { color in
            #if os(iOS)
            var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
            guard UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return }
            #else
            guard let resolved = NSColor(color).usingColorSpace(.sRGB) else { return }
            let red = resolved.redComponent, green = resolved.greenComponent, blue = resolved.blueComponent
            #endif
            guard let value = XgentHexColor.value(red: red, green: green, blue: blue) else { return }
            draft = value
            publish(draft)
        })
    }

    private func publish(_ value: String) {
        guard let normalized = XgentHexColor.normalized(value), normalized != accepted.lowercased() else { return }
        model.send(node, in: document, value: .string(normalized), editing: true)
    }

    private var editor: some View {
        HStack(spacing: 12) {
            ColorPicker(node.label ?? "", selection: color, supportsOpacity: false)
                .labelsHidden()
                .frame(width: 44, height: 44)
                .accessibilityLabel(node.label ?? "")
                .accessibilityIdentifier(node.id)
            TextField("#RRGGBB", text: $draft)
                .textFieldStyle(.plain)
                .modifier(XgentFieldSurface(node: node))
                .frame(width: 120)
                .focused($editingHex)
                .accessibilityIdentifier("\(node.id):hex")
                .accessibilityLabel("\(node.label ?? "") HEX")
                .accessibilityHint(node.accessibilityHint ?? "#RRGGBB")
                .overlay {
                    if !valid {
                        RoundedRectangle(cornerRadius: 8).stroke(Color.red, lineWidth: 1)
                            .allowsHitTesting(false)
                    }
                }
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                #else
                .onExitCommand { draft = accepted }
                #endif
                .onChange(of: draft) { _, next in publish(next) }
                .onSubmit { publish(draft) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isSettingsRow { XgentSettingsValueRow(node: node) { editor } }
            else {
                XgentFieldLabel(node: node)
                editor
            }
            if !valid {
                Text(node.accessibilityHint ?? "#RRGGBB")
                    .font(.caption).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onAppear { draft = accepted }
        .onChange(of: accepted) { _, next in if !editingHex { draft = next } }
        .onChange(of: editingHex) { _, editing in if !editing && valid { draft = accepted } }
        .disabled(node.disabled == true)
        .accessibilityElement(children: .contain)
    }
}
