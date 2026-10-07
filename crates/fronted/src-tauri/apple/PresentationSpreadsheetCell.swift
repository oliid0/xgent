import SwiftUI

struct XgentSpreadsheetCell: View {
    let cell: XgentSpreadsheetData.Cell
    let row: Int
    let sheet: String
    let editable: Bool
    let width: CGFloat
    let revision: Int
    let change: (XgentSpreadsheetData.Edit) -> Void
    @State private var draft = ""
    @State private var pending: String?
    @FocusState private var focused: Bool
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .body) private var textScale = 1.0

    private var coordinate: String { "\(XgentSpreadsheetData.columnName(cell.columnIndex))\(row + 1)" }

    var body: some View {
        Group {
            if editable {
                TextField(coordinate, text: Binding(get: { draft }, set: { value in
                    let bounded = XgentSpreadsheetCellText.bounded(value)
                    draft = bounded
                    pending = bounded
                    change(.init(sheet: sheet, row: row, column: cell.columnIndex, value: bounded))
                }))
                .textFieldStyle(.plain)
                .focused($focused)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                #endif
            } else {
                Text(cell.value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(XgentFonts.code(theme.codeFontFamily, size: CGFloat(theme.typography.body * theme.fontScale) * textScale))
        .padding(.horizontal, 8)
        .frame(width: width, height: max(44, 30 * textScale), alignment: .leading)
        .background(focused ? Color(xgentHex: theme.palette(for: scheme).muted) : Color.clear)
        .overlay(alignment: .bottom) { Divider() }
        .overlay(alignment: .trailing) { Divider() }
        .accessibilityIdentifier("spreadsheet-cell:\(sheet):\(row):\(cell.columnIndex)")
        .accessibilityLabel("\(sheet), \(coordinate)")
        .onAppear { draft = cell.value }
        .onChange(of: cell.value) { _, value in
            // Older documents must not replace a newer keystroke awaiting acknowledgement.
            if pending == nil || pending == value {
                draft = value
                pending = nil
            }
        }
        .onChange(of: revision) { _, _ in
            if pending == cell.value { pending = nil }
        }
    }
}
