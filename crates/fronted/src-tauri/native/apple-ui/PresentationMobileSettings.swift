#if os(iOS)
import SwiftUI
import UIKit

// Grouping preserves every business row. The mobile composition supplies
// explicit card geometry, rather than depending on a platform Form's defaults.
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
    var showsRootClose = false

    private var sections: [XgentSettingsFormSection] { XgentSettingsFormSection.sections(nodes) }
    private var route: String { nodes.first(where: { $0.kind == .settingsGroup })?.id ?? document.id }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                ForEach(sections) { section in
                    let closesHere = showsRootClose && section.id == sections.first?.id && document.dismissAction != nil
                    VStack(alignment: .leading, spacing: closesHere ? 0 : 10) {
                        if !section.labels.isEmpty || closesHere {
                            XgentIOSSettingsSectionHeader(labels: section.labels, document: document,
                                model: model, showsClose: closesHere)
                        }
                        if !section.leadingNotes.isEmpty {
                            notes(section.leadingNotes).padding(.horizontal, 16)
                        }
                        XgentIOSSettingsCard(section: section, document: document, model: model)
                        if !section.trailingNotes.isEmpty {
                            notes(section.trailingNotes).padding(.horizontal, 16)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, showsRootClose ? 16 : 20)
            .padding(.bottom, 32)
        }
        .environment(\.xgentIOSFormRow, true)
        .environment(\.xgentSettingsRow, true)
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
