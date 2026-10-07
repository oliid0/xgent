import Foundation

enum XgentComposerRange {
    // Foundation's NSRange conversion can accept offsets inside a UTF-16
    // surrogate or a composed character on Darwin. Native reference editing
    // must only own complete characters, including emoji and combining marks.
    static func isValid(_ range: NSRange, in text: String) -> Bool {
        let count = text.utf16.count
        guard range.location >= 0, range.length >= 0, range.location <= count,
              range.length <= count - range.location else { return false }
        let end = range.location + range.length
        var hasStart = range.location == count, hasEnd = end == count
        for index in text.indices {
            let offset = index.utf16Offset(in: text)
            if offset == range.location { hasStart = true }
            if offset == end { hasEnd = true }
            if offset > end { break }
        }
        return hasStart && hasEnd
    }
}
