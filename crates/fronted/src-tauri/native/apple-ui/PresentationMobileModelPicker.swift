#if os(iOS)
import SwiftUI

struct XgentIOSModelPicker: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var currentDocument: XgentDocument? {
        model.documents.first { $0.surface == document.surface }
    }
    private var currentNode: XgentNode? { currentDocument?.node(id: node.id) }

    private var groups: [XgentModelOptionGroup] {
        XgentModelOptions.groups(currentNode?.options ?? [], query: query)
    }

    var body: some View {
        NavigationStack {
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
                                        .foregroundStyle(.primary)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 8)
                                    if let currentNode, option.value == model.value(currentNode, in: document).text {
                                        Image(systemName: "checkmark").foregroundStyle(.tint)
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                            }
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
            .background { XgentThemeBackground().ignoresSafeArea() }
            .overlay {
                if groups.isEmpty {
                    let empty = currentNode?.children?.first { $0.kind == .emptyState }
                    ContentUnavailableView {
                        Label(empty?.label ?? "No matching models", systemImage: "magnifyingglass")
                    }
                }
            }
            .navigationTitle(currentNode?.label ?? node.label ?? "Model")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: Text(currentNode?.text ?? node.text ?? node.label ?? "Model"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel(Text("Close"))
                }
            }
        }
        .presentationDetents([.large])
        .onChange(of: currentNode == nil || currentNode?.disabled == true) { _, unavailable in
            if unavailable { dismiss() }
        }
        .modifier(XgentPresentationThemeModifier(theme: currentDocument?.theme ?? document.theme ?? .fallback,
                                                  appearance: currentDocument?.appearance ?? document.appearance))
    }
}
#endif
