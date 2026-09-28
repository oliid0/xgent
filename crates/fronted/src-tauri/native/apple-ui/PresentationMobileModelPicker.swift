#if os(iOS)
import SwiftUI

struct XgentIOSModelPicker: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var groups: [XgentModelOptionGroup] {
        XgentModelOptions.groups(node.options ?? [], query: query)
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.options) { option in
                            Button {
                                model.send(node, in: document, value: .string(option.value), editing: true)
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    Text(option.displayLabel)
                                        .foregroundStyle(.primary)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 8)
                                    if option.value == model.value(node, in: document).text {
                                        Image(systemName: "checkmark").foregroundStyle(.tint)
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .disabled(option.disabled == true || node.disabled == true)
                            .accessibilityIdentifier("model-option:\(option.value)")
                        }
                    } header: {
                        if !group.label.isEmpty { Text(group.label) }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .background { XgentThemeBackground().ignoresSafeArea() }
            .overlay {
                if groups.isEmpty {
                    let empty = node.children?.first { $0.kind == .emptyState }
                    ContentUnavailableView {
                        Label(empty?.label ?? "No matching models", systemImage: "magnifyingglass")
                    }
                }
            }
            .navigationTitle(node.label ?? "Model")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: Text(node.text ?? node.label ?? "Model"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel(Text("Close"))
                }
            }
        }
        .presentationDetents([.large])
        .modifier(XgentPresentationThemeModifier(theme: document.theme ?? .fallback,
                                                  appearance: document.appearance))
    }
}
#endif
