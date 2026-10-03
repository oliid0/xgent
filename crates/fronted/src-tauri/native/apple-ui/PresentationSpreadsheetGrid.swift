import SwiftUI

struct XgentSpreadsheetGrid: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @ScaledMetric(relativeTo: .body) private var cellWidth: CGFloat = 120
    @ScaledMetric(relativeTo: .caption) private var rowWidth: CGFloat = 44

    var body: some View {
        Group {
            if let table = XgentSpreadsheetData.decode(node.value?.text ?? "") {
                ScrollView(.horizontal) {
                    ScrollView(.vertical) {
                        LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                            Section {
                                ForEach(table.rows) { row in
                                    HStack(spacing: 0) {
                                        Text("\(row.rowIndex + 1)").font(.caption.monospacedDigit())
                                            .foregroundStyle(.secondary).frame(width: rowWidth)
                                        ForEach(row.cells) { cell in
                                            XgentSpreadsheetCell(cell: cell, row: row.rowIndex, sheet: table.sheet,
                                                editable: table.editable && node.disabled != true && node.action != nil,
                                                width: cellWidth, revision: document.revision) { edit in
                                                    guard let encoded = edit.encoded else { return }
                                                    model.send(node, in: document, value: .string(encoded), continuous: true)
                                                }
                                        }
                                    }
                                }
                            } header: {
                                XgentSpreadsheetHeader(columns: table.rows.first?.cells.count ?? 0,
                                    cellWidth: cellWidth, rowWidth: rowWidth)
                            }
                        }
                        .id("\(document.surface):\(table.sheet)")
                        .frame(width: rowWidth + cellWidth * CGFloat(table.rows.first?.cells.count ?? 0), alignment: .leading)
                    }
                    .scrollDismissesKeyboard(.interactively)
                }
                .accessibilityLabel(node.label ?? table.sheet)
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 120, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
    }
}
