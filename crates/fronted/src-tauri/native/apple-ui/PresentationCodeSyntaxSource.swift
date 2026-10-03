import Foundation

// A changed line can change every later lexical state. Only complete unchanged
// lines before that edit remain safe until the shared lexer publishes its result.
struct XgentCodeSyntaxSource {
    private let expected: String?
    private var lastActual: String?
    private var synchronized = false
    private(set) var length = 0
    private(set) var exact = false
    init(_ expected: String?) { self.expected = expected }

    mutating func synchronize(_ actual: String?) -> Bool {
        if synchronized, actual == lastActual { return exact || length > 0 }
        synchronized = true; lastActual = actual; length = 0; exact = false
        guard let expected, let actual else { return false }
        if expected == actual { exact = true; length = expected.utf16.count; return true }
        let before = expected as NSString, after = actual as NSString
        let limit = min(before.length, after.length)
        var offset = 0
        while offset < limit, before.character(at: offset) == after.character(at: offset) {
            let unit = before.character(at: offset)
            offset += 1
            if unit == 10 || unit == 13 { length = offset }
        }
        return length > 0
    }
    func clip(_ range: NSRange) -> NSRange? {
        guard range.location >= 0, range.length > 0, range.location < length,
              range.length <= Int.max - range.location else { return nil }
        return NSRange(location: range.location, length: min(range.length, length - range.location))
    }
}
