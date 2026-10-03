#if os(iOS)
import SwiftUI

// Native Form sections own spacing and surfaces. A nested Shell workspace group
// must not become another rounded card inside an already grouped form row.
struct XgentSettingsFormSection: Identifiable {
    let id: String
    let labels: [String]
    let rows: [XgentNode]

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
    @ScaledMetric(relativeTo: .caption) private var headerScale = 1.0

    private var sections: [XgentSettingsFormSection] { XgentSettingsFormSection.sections(nodes) }
    private var route: String { nodes.first(where: { $0.kind == .settingsGroup })?.id ?? document.id }

    var body: some View {
        Form {
            ForEach(sections) { section in
                Section {
                    ForEach(section.rows) { row in
                        XgentIOSNode(node: row, document: document, model: model, parentAxis: .vertical)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                            .listRowBackground(Color(xgentHex: theme.palette(for: colorScheme).card))
                    }
                } header: {
                    if !section.labels.isEmpty {
                        Text(section.labels.joined(separator: " / "))
                            .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * headerScale))
                            .fixedSize(horizontal: false, vertical: true)
                            .textCase(nil)
                            .accessibilityAddTraits(.isHeader)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .environment(\.xgentIOSFormRow, true)
        .environment(\.xgentSettingsRow, true)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .id("\(document.id):\(route)")
    }
}
#endif
