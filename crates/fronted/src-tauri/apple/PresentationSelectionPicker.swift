import SwiftUI

/// Long settings lists use searchable native controls, rather than hundreds of menu items.
struct XgentSelectionPicker: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Binding var isPresented: Bool
    @State private var query = ""
    @FocusState private var queryFocused: Bool

    private var currentDocument: XgentDocument? { model.documents.first { $0.surface == document.surface } }
    private var currentNode: XgentNode? { currentDocument?.node(id: node.id) }
    private var source: XgentNode { currentNode ?? node }
    private var searchLabel: String {
        source.children?.first { $0.id == "\(source.id):search" }?.label
            ?? source.children?.first?.label ?? source.text ?? source.label ?? ""
    }
    private var options: [XgentOption] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return (source.options ?? []).filter { search.isEmpty || $0.label.localizedStandardContains(search) }
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Text(source.label ?? "").font(.headline).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Button { isPresented = false } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                    .buttonStyle(.plain)
                    #if os(iOS)
                    .foregroundStyle(.primary)
                    .modifier(XgentGlassCircle())
                    #endif
                    .accessibilityLabel(source.children?.last?.label ?? "")
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").accessibilityHidden(true)
                TextField(searchLabel, text: $query)
                    .textFieldStyle(.plain)
                    .focused($queryFocused)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    #endif
                    .accessibilityIdentifier("\(node.id):search")
                    .accessibilityLabel(searchLabel)
                if !query.isEmpty {
                    Button {
                        query = ""
                        queryFocused = true
                    } label: { Image(systemName: "xmark.circle.fill").frame(minWidth: 32, minHeight: 44) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("\(node.id):search-clear")
                    .accessibilityLabel(source.children?.first { $0.id.hasSuffix(":search-clear-label") }?.label ?? "")
                }
            }
            .modifier(XgentFieldSurface(node: node))
            List {
                ForEach(options) { option in
                    Button {
                        guard let currentNode, let currentDocument,
                              currentNode.action == node.action, currentNode.disabled != true else { return }
                        model.send(currentNode, in: currentDocument, value: .string(option.value), editing: true)
                        isPresented = false
                    } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(node.variant == "composer-model" ? option.displayLabel : option.label)
                                    .fixedSize(horizontal: false, vertical: true)
                                if node.variant == "composer-model", let group = option.groupLabel, !group.isEmpty {
                                    Text(group).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 8)
                            if option.value == model.value(source, in: currentDocument ?? document).text {
                                Image(systemName: "checkmark").accessibilityHidden(true)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(option.disabled == true)
                    .accessibilityIdentifier("\(node.id):option:\(option.value)")
                    .accessibilityAddTraits(option.value == model.value(source, in: currentDocument ?? document).text ? [.isSelected] : [])
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .overlay {
                if options.isEmpty {
                    Text(source.children?.first { $0.kind == .emptyState }?.label ?? "")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding()
                }
            }
        }
        .padding(16)
        .environment(\.xgentSettingsRow, false)
        .background { XgentThemeBackground() }
        .preferredColorScheme((currentDocument ?? document).colorScheme)
        .modifier(XgentPresentationThemeModifier(theme: currentDocument?.theme ?? document.theme ?? .fallback,
            appearance: currentDocument?.appearance ?? document.appearance))
        .onChange(of: currentNode == nil || currentNode?.disabled == true || currentNode?.action != node.action) { _, unavailable in
            if unavailable { isPresented = false }
        }
    }
}

struct XgentSelectionPresentation: ViewModifier {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Binding var isPresented: Bool

    func body(content: Content) -> some View {
        #if os(iOS)
        content.sheet(isPresented: $isPresented) {
            XgentSelectionPicker(node: node, document: document, model: model, isPresented: $isPresented)
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        }
        #else
        content.popover(isPresented: $isPresented, arrowEdge: node.variant == "composer-model" ? .bottom : nil) {
            XgentSelectionPicker(node: node, document: document, model: model, isPresented: $isPresented)
                .frame(width: 360, height: 420)
        }
        #endif
    }
}
