import Foundation

struct XgentSpreadsheetData: Decodable {
    struct Cell: Decodable, Identifiable {
        let columnIndex: Int
        let value: String
        var id: Int { columnIndex }
    }
    struct Row: Decodable, Identifiable {
        let rowIndex: Int
        let cells: [Cell]
        var id: Int { rowIndex }
    }
    let sheet: String
    let editable: Bool
    let rows: [Row]

    static func decode(_ value: String) -> Self? {
        guard let bytes = value.data(using: .utf8),
              let table = try? JSONDecoder().decode(Self.self, from: bytes),
              table.rows.count <= 250 else { return nil }
        // Coordinates come from the shared parser, never from arbitrary native commands.
        for (index, row) in table.rows.enumerated() {
            guard row.rowIndex == index, row.cells.count <= 80 else { return nil }
            for (column, cell) in row.cells.enumerated() {
                guard cell.columnIndex == column else { return nil }
            }
        }
        return table
    }

    static func columnName(_ index: Int) -> String {
        guard index >= 0 else { return "" }
        var number = index + 1
        var label = ""
        while number > 0 {
            number -= 1
            label = String(UnicodeScalar(65 + number % 26)!) + label
            number /= 26
        }
        return label
    }

    struct Edit: Encodable {
        let sheet: String
        let row: Int
        let column: Int
        let value: String

        var encoded: String? {
            guard value.utf16.count <= XgentSpreadsheetCellText.maximumLength else { return nil }
            guard let bytes = try? JSONEncoder().encode(self) else { return nil }
            return String(data: bytes, encoding: .utf8)
        }
    }
}
