import Foundation

// Monaco and native code references use one-based lines and UTF-16 columns.
struct XgentCodeLocation: Decodable, Equatable {
    let request: String
    let line: Int
    let endLine: Int?
    let column: Int?

    static func decode(_ text: String?) -> XgentCodeLocation? {
        guard let text, let location = try? JSONDecoder().decode(Self.self, from: Data(text.utf8)),
              !location.request.isEmpty, location.line > 0,
              location.endLine.map({ $0 > 0 }) ?? true,
              location.column.map({ $0 > 0 }) ?? true else { return nil }
        return location
    }

    func range(in text: String) -> NSRange {
        let units = Array(text.utf16)
        var lines: [(start: Int, end: Int)] = []
        var start = 0, offset = 0
        while offset < units.count {
            if units[offset] == 10 || units[offset] == 13 {
                lines.append((start, offset))
                if units[offset] == 13, offset + 1 < units.count, units[offset + 1] == 10 { offset += 1 }
                start = offset + 1
            }
            offset += 1
        }
        lines.append((start, units.count))
        let first = min(max(1, line), lines.count) - 1
        let last = min(max(first + 1, endLine ?? first + 1), lines.count) - 1
        let available = lines[first].end - lines[first].start
        let requestedColumn = min(max(1, column ?? 1), available + 1) - 1
        var location = lines[first].start + requestedColumn
        // Never ask TextKit to select only the second UTF-16 unit of a scalar.
        if location > lines[first].start, location < lines[first].end,
           (0xD800...0xDBFF).contains(units[location - 1]), (0xDC00...0xDFFF).contains(units[location]) { location -= 1 }
        return NSRange(location: location, length: max(0, lines[last].end - location))
    }
}
