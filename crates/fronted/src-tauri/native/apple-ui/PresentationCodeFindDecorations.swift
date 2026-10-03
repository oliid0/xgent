import Foundation

struct XgentCodeFindDecorations: Decodable, Equatable {
    let source: String
    let matches: [XgentCodeFindRange]
    let scopes: [XgentCodeFindRange]
    let revision: Int
}

// Rendering works on a fragment at a time. Keep sorted, merged paint ranges so
// a visible fragment does not scan thousands of offscreen search results.
struct XgentCodeFindDecorationIndex {
    let matches: [NSRange]
    let scopes: [NSRange]
    private let exactMatches: Set<NSRange>

    init(_ decorations: XgentCodeFindDecorations) {
        let source = decorations.source as NSString, count = source.length
        func valid(_ range: XgentCodeFindRange) -> Bool {
            guard range.location >= 0, range.length > 0, range.location <= count,
                  range.length <= count - range.location else { return false }
            func boundary(_ offset: Int) -> Bool {
                offset == 0 || offset == count ||
                    !(0xD800...0xDBFF).contains(source.character(at: offset - 1)) ||
                    !(0xDC00...0xDFFF).contains(source.character(at: offset))
            }
            return boundary(range.location) && boundary(range.location + range.length)
        }
        let found = decorations.matches.filter(valid).map(\.range)
        exactMatches = Set(found)
        matches = Self.merge(found)
        scopes = Self.merge(decorations.scopes.filter(valid).map(\.range))
    }

    func matches(in fragment: NSRange) -> [NSRange] { Self.intersections(matches, with: fragment) }
    func scopes(in fragment: NSRange) -> [NSRange] { Self.intersections(scopes, with: fragment) }
    func containsMatch(_ range: NSRange) -> Bool {
        exactMatches.contains(range)
    }

    private static func merge(_ ranges: [NSRange]) -> [NSRange] {
        let sorted = ranges.sorted { $0.location < $1.location || ($0.location == $1.location && $0.length < $1.length) }
        var result: [NSRange] = []
        for range in sorted {
            if let prior = result.last, range.location <= NSMaxRange(prior) {
                result[result.count - 1].length = max(NSMaxRange(prior), NSMaxRange(range)) - prior.location
            } else { result.append(range) }
        }
        return result
    }
    private static func intersections(_ ranges: [NSRange], with fragment: NSRange) -> [NSRange] {
        guard fragment.location >= 0, fragment.location != NSNotFound, fragment.length > 0,
              fragment.length <= Int.max - fragment.location else { return [] }
        var low = 0, high = ranges.count
        while low < high {
            let mid = (low + high) / 2
            if NSMaxRange(ranges[mid]) <= fragment.location { low = mid + 1 } else { high = mid }
        }
        var result: [NSRange] = []
        for index in low..<ranges.count {
            let range = ranges[index]
            if range.location >= NSMaxRange(fragment) { break }
            let intersection = NSIntersectionRange(range, fragment)
            if intersection.length > 0 { result.append(intersection) }
        }
        return result
    }
}
