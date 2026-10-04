#if os(iOS)
import SwiftUI
import UIKit

// Native Form sections own spacing and surfaces. A nested Shell workspace group
// must not become another rounded card inside an already grouped form row.
struct XgentSettingsFormSection: Identifiable {
    let id: String
    let labels: [String]
    let rows: [XgentNode]

    // Secondary explanations are part of the document, but are not controls.
    // Native section headers/footers keep them outside the white control card.
    private func isNote(_ node: XgentNode) -> Bool {
        node.kind == .text && node.secondary == true && node.action == nil
            && node.id != "save-status"
    }

    var hasControls: Bool { rows.contains { !isNote($0) } }
    var leadingNotes: [XgentNode] { hasControls ? Array(rows.prefix(while: isNote)) : [] }
    var trailingNotes: [XgentNode] {
        hasControls ? Array(rows.dropFirst(leadingNotes.count).reversed().prefix(while: isNote).reversed()) : []
    }
    var controlRows: [XgentNode] {
        Array(rows.dropFirst(leadingNotes.count).dropLast(trailingNotes.count))
    }

    static func sections(_ nodes: [XgentNode], labels: [String] = []) -> [Self] {
        var result: [Self] = []
        var rows: [XgentNode] = []
        func flush() {
            guard let first = rows.first else { return }
            result.append(Self(id: first.id, labels: labels, rows: rows))
            rows.removeAll()
        }
        for node in nodes {
            if node.kind == .settingsGroup {
                flush()
                let title = node.label.map { $0.isEmpty ? [] : [$0] } ?? []
                result.append(contentsOf: sections(node.children ?? [], labels: labels + title))
            } else { rows.append(node) }
        }
        flush()
        return result
    }
}

struct XgentIOSSettingsForm: View {
    let nodes: [XgentNode]
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .subheadline) private var headerScale = 1.0

    private var sections: [XgentSettingsFormSection] { XgentSettingsFormSection.sections(nodes) }
    private var route: String { nodes.first(where: { $0.kind == .settingsGroup })?.id ?? document.id }

    var body: some View {
        Form {
            ForEach(sections) { section in
                Section {
                    ForEach(section.controlRows) { row in
                        XgentIOSNode(node: row, document: document, model: model, parentAxis: .vertical)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                            .listRowBackground(section.hasControls
                                ? Color(xgentHex: theme.palette(for: colorScheme).card) : Color.clear)
                            .listRowSeparator(.hidden, edges: .top)
                            .listRowSeparator(section.hasControls && row.id != section.controlRows.last?.id
                                ? .visible : .hidden, edges: .bottom)
                    }
                } header: {
                    if !section.labels.isEmpty {
                        Text(section.labels.joined(separator: " / "))
                            .font(XgentFonts.body(theme.fontFamily, size: CGFloat(15 * theme.fontScale) * headerScale, weight: .semibold))
                            .foregroundStyle(Color(uiColor: .secondaryLabel))
                            .fixedSize(horizontal: false, vertical: true)
                            .textCase(nil)
                            .accessibilityAddTraits(.isHeader)
                    }
                    notes(section.leadingNotes)
                } footer: {
                    notes(section.trailingNotes)
                }
                .listSectionSeparator(.hidden)
            }
        }
        .formStyle(.grouped)
        .environment(\.xgentIOSFormRow, true)
        .environment(\.xgentSettingsRow, true)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .id("\(document.id):\(route)")
    }

    private func notes(_ nodes: [XgentNode]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(nodes) { node in
                XgentIOSNode(node: node, document: document, model: model, parentAxis: .vertical)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .textCase(nil)
    }
}
#endif
