import Foundation

struct XgentCodeSyntaxRun: Equatable {
    let range: NSRange
    let style: Int
}
struct XgentCodeSyntaxIndex {
    private let runs: [XgentCodeSyntaxRun]
    init?(_ configuration: XgentCodeSyntaxConfiguration) {
        self.init(source: configuration.source, styleCount: configuration.styles.count, runs: configuration.runs)
    }
    init?(source: String, styleCount: Int, runs: [[Int]]) {
        let text = source as NSString
        var found: [XgentCodeSyntaxRun] = [], end = 0
        func boundary(_ offset: Int) -> Bool {
            offset == 0 || offset == text.length || !(CFStringIsSurrogateHighCharacter(text.character(at: offset - 1)) && CFStringIsSurrogateLowCharacter(text.character(at: offset)))
        }
        for value in runs {
            guard value.count == 3 else { return nil }
            let start = value[0], length = value[1], style = value[2]
            guard start >= end, length > 0, start <= text.length, length <= text.length - start,
                  style >= 0, style < styleCount, boundary(start), boundary(start + length) else { return nil }
            let range = NSRange(location: start, length: length)
            found.append(.init(range: range, style: style)); end = start + length
        }
        self.runs = found
    }
    func intersections(_ fragment: NSRange) -> [XgentCodeSyntaxRun] {
        guard fragment.location >= 0, fragment.length > 0, fragment.location < Int.max,
              fragment.length <= Int.max - fragment.location else { return [] }
        let end = NSMaxRange(fragment)
        var lower = 0, upper = runs.count
        while lower < upper {
            let middle = lower + (upper - lower) / 2
            if NSMaxRange(runs[middle].range) <= fragment.location { lower = middle + 1 } else { upper = middle }
        }
        var result: [XgentCodeSyntaxRun] = []
        while lower < runs.count, runs[lower].range.location < end {
            result.append(.init(range: NSIntersectionRange(runs[lower].range, fragment), style: runs[lower].style)); lower += 1
        }
        return result
    }
}
