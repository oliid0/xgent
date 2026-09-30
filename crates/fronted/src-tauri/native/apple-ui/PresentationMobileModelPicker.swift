#if os(iOS)
import SwiftUI

struct XgentIOSModelPicker: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var systemScheme
    @State private var query = ""

    private var currentDocument: XgentDocument? {
        model.documents.first { $0.surface == document.surface }
    }
    private var currentNode: XgentNode? { currentDocument?.node(id: node.id) }

    private var groups: [XgentModelOptionGroup] {
        XgentModelOptions.groups(currentNode?.options ?? [], query: query)
    }
    private var displayedScheme: ColorScheme {
        (currentDocument ?? document).colorScheme ?? systemScheme
    }
    private var displayedBackground: Color {
        let theme = currentDocument?.theme ?? document.theme ?? .fallback
        return Color(xgentHex: theme.palette(for: displayedScheme).background)
    }
    private var palette: XgentPalette {
        (currentDocument?.theme ?? document.theme ?? .fallback).palette(for: displayedScheme)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(currentNode?.label ?? node.label ?? "Model")
                    .font(.headline)
                    .foregroundStyle(Color(xgentHex: palette.text))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button { dismiss() } label: { Image(systemName: "xmark") }
                    .accessibilityLabel(Text("Close"))
                    .frame(minWidth: 44, minHeight: 44)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color(xgentHex: palette.secondaryText))
                TextField(
                    "Search models",
                    text: $query,
                    prompt: Text(currentNode?.text ?? node.text ?? node.label ?? "Model")
                        .foregroundStyle(Color(xgentHex: palette.secondaryText))
                )
                .foregroundStyle(Color(xgentHex: palette.text))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("model-search")
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .accessibilityLabel(Text("Clear search"))
                        .foregroundStyle(Color(xgentHex: palette.secondaryText))
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(Color(xgentHex: palette.card), in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            List {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.options) { option in
                            Button {
                                guard let currentNode, let currentDocument else { return }
                                model.send(currentNode, in: currentDocument, value: .string(option.value), editing: true)
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    Text(option.displayLabel)
                                        .foregroundStyle(Color(xgentHex: palette.text))
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 8)
                                    if let currentNode, option.value == model.value(currentNode, in: document).text {
                                        Image(systemName: "checkmark").foregroundStyle(.tint)
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(option.disabled == true || currentNode == nil || currentNode?.disabled == true)
                            .accessibilityIdentifier("model-option:\(option.value)")
                        }
                    } header: {
                        if !group.label.isEmpty { Text(group.label) }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .overlay {
                if groups.isEmpty {
                    let empty = currentNode?.children?.first { $0.kind == .emptyState }
                    ContentUnavailableView {
                        Label(empty?.label ?? "No matching models", systemImage: "magnifyingglass")
                    }
                }
            }
        }
        .background(displayedBackground.ignoresSafeArea())
        .presentationDetents([.large])
        .preferredColorScheme((currentDocument ?? document).colorScheme)
        .onChange(of: currentNode == nil || currentNode?.disabled == true) { _, unavailable in
            if unavailable { dismiss() }
        }
        .modifier(XgentPresentationThemeModifier(theme: currentDocument?.theme ?? document.theme ?? .fallback,
                                                  appearance: currentDocument?.appearance ?? document.appearance))
    }
}
#endif
