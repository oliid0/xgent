import SwiftUI
import SwiftUIIntrospect

// Search owns its input and bounded results viewport. Business results and
// selection actions come from the same source as the Astryx command palette.
struct XgentWorkspaceSearchPalette: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var queryFocused: Bool
    @State private var selectedID: String?
    @StateObject private var fieldState = XgentWorkspaceSearchFieldState()

    private var query: XgentNode? { node.children?.first { $0.id == "workspace-search-query" } }
    private var groups: [XgentNode] {
        node.children?.first { $0.id == "workspace-search-results" }?.children ?? []
    }
    private var results: [XgentNode] { groups.flatMap { $0.children ?? [] } }
    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var queryCurrent: Bool {
        guard let query else { return false }
        return model.value(query, in: document).text == query.value?.text
    }
    private var selection: XgentNode? {
        results.first { $0.id == selectedID && $0.disabled != true } ?? results.first { $0.disabled != true }
    }

    var body: some View {
        VStack(spacing: 0) {
            if let query {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
                    TextField(query.label ?? "", text: Binding(
                        get: { model.value(query, in: document).text },
                        set: { next in
                            guard next != model.value(query, in: document).text else { return }
                            model.send(query, in: document, value: .string(next), editing: true)
                        }))
                        .textFieldStyle(.plain)
                        .font(.body)
                        .focused($queryFocused)
                        #if os(iOS)
                        .introspect(.textField, on: .iOS(.v26)) { field in
                            fieldState.field = field
                            field.accessibilityIdentifier = query.id
                            field.accessibilityLabel = query.label ?? ""
                        }
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        #else
                        .introspect(.textField, on: .macOS(.v15, .v26)) { field in
                            fieldState.field = field
                            field.setAccessibilityIdentifier(query.id)
                            field.setAccessibilityLabel(query.label ?? "")
                        }
                        #endif
                        .accessibilityIdentifier(query.id)
                        .accessibilityLabel(query.label ?? "")
                        .onSubmit { activateSelection() }
                        .onKeyPress(.downArrow) {
                            guard !fieldState.composing else { return .ignored }
                            moveSelection(1); return .handled
                        }
                        .onKeyPress(.upArrow) {
                            guard !fieldState.composing else { return .ignored }
                            moveSelection(-1); return .handled
                        }
                        .onKeyPress(.escape) {
                            guard !fieldState.composing else { return .ignored }
                            model.dismiss(document); return .handled
                        }
                }
                .padding(12).frame(minHeight: 48)
                .background(Color(xgentHex: palette.muted).opacity(0.6),
                            in: RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal, 16).padding(.bottom, 12)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(groups) { group in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(group.label ?? "").font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.horizontal, 12)
                                    .accessibilityAddTraits(.isHeader)
                                ForEach(group.children ?? []) { result in resultRow(result).id(result.id) }
                            }
                        }
                        ForEach((node.children ?? []).filter {
                            ["workspace-search-loading", "workspace-search-empty", "workspace-search-error", "workspace-search-retry"].contains($0.id)
                        }) { status in
                            XgentNodeView(node: status, document: document, model: model)
                        }
                    }.padding(.horizontal, 12).padding(.bottom, 16)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: selectedID) { _, id in
                    if let id { proxy.scrollTo(id, anchor: .center) }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { queryFocused = true }
        // A new query/action scope invalidates the prior keyboard selection.
        .onChange(of: results.map(\.action)) { _, _ in selectedID = nil }
        .accessibilityElement(children: .contain)
    }

    private func resultRow(_ result: XgentNode) -> some View {
        Button { if queryCurrent { model.send(result, in: document) } } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: result.icon ?? "magnifyingglass").frame(width: 20).padding(.top, 3).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(result.label ?? "").font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                    if let description = result.text, !description.isEmpty {
                        Text(description).font(.subheadline).foregroundStyle(.secondary)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(12).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(selectedID == result.id ? Color(xgentHex: palette.neutral ?? palette.muted) : .clear,
                        in: RoundedRectangle(cornerRadius: 14))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!queryCurrent || result.disabled == true || model.isBusy(result, in: document))
        .accessibilityIdentifier(result.id)
        .accessibilityLabel(result.label ?? "")
        .accessibilityHint(result.text ?? "")
        .accessibilityAddTraits(selectedID == result.id ? .isSelected : [])
    }

    private func moveSelection(_ offset: Int) {
        guard queryCurrent else { return }
        let enabled = results.filter { $0.disabled != true && !model.isBusy($0, in: document) }
        guard !enabled.isEmpty else { return }
        let index = enabled.firstIndex { $0.id == selectedID } ?? (offset > 0 ? -1 : 0)
        selectedID = enabled[(index + offset + enabled.count) % enabled.count].id
    }

    private func activateSelection() {
        guard !fieldState.composing, queryCurrent, let selection, !model.isBusy(selection, in: document) else { return }
        model.send(selection, in: document)
    }
}
