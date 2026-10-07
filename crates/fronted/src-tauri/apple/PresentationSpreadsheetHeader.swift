import SwiftUI

struct XgentSpreadsheetHeader: View {
    let columns: Int
    let cellWidth: CGFloat
    let rowWidth: CGFloat
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 0) {
            Text("#").frame(width: rowWidth)
            ForEach(0..<columns, id: \.self) { column in
                Text(XgentSpreadsheetData.columnName(column))
                    .frame(width: cellWidth)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .font(.caption.monospaced().weight(.medium))
        .frame(minHeight: 36)
        .background(Color(xgentHex: theme.palette(for: scheme).muted))
        .overlay(alignment: .bottom) { Divider() }
    }
}
