import Foundation

enum XgentSpreadsheetCellText {
    static let maximumLength = 32767

    // Excel counts UTF-16 units; never cut an emoji's surrogate pair at the boundary.
    static func bounded(_ value: String) -> String {
        guard value.utf16.count > maximumLength else { return value }
        var count = 0
        var end = value.unicodeScalars.startIndex
        while end < value.unicodeScalars.endIndex {
            let size = value.unicodeScalars[end].value > 0xFFFF ? 2 : 1
            guard count + size <= maximumLength else { break }
            count += size
            end = value.unicodeScalars.index(after: end)
        }
        return String(value.unicodeScalars[..<end])
    }
}
