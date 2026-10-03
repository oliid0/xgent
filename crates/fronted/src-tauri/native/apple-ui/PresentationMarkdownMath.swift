import Foundation

// Match the shared math plugin's multi-dollar delimiters. Single dollars stay
// prose, and code fences/spans and link destinations retain their exact source.
enum XgentMarkdownMath {
    static func prepare(_ source: String, renderKey: String? = nil) -> String {
        let lines = source.components(separatedBy: "\n")
        var output: [String] = [], index = 0
        var fence: (Character, Int)?
        while index < lines.count {
            let line = lines[index]
            let prefix = containerPrefix(line)
            let content = String(line.dropFirst(prefix.count))
            if let active = fence {
                output.append(line)
                let run = content.prefix(while: { $0 == active.0 }).count
                if run >= active.1 && content.dropFirst(run).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { fence = nil }
                index += 1; continue
            }
            if line.hasPrefix("    ") || line.hasPrefix("\t") { output.append(line); index += 1; continue }
            if let first = content.first, first == "`" || first == "~" {
                let count = content.prefix(while: { $0 == first }).count
                if count >= 3 { fence = (first, count); output.append(line); index += 1; continue }
            }
            let count = content.prefix(while: { $0 == "$" }).count
            if count >= 2 && !content.dropFirst(count).contains("$") {
                // Fence metadata is ignored by the shared KaTeX renderer.
                var body: [String] = [], next = index + 1, closed = false
                while next < lines.count {
                    let candidate = lines[next]
                    if !prefix.trimmingCharacters(in: .whitespaces).isEmpty && !candidate.hasPrefix(prefix) { break }
                    let unwrapped = candidate.hasPrefix(prefix) ? String(candidate.dropFirst(prefix.count)) : candidate
                    let closeCount = unwrapped.prefix(while: { $0 == "$" }).count
                    if closeCount >= count && unwrapped.dropFirst(closeCount).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        closed = true; next += 1; break
                    }
                    body.append(unwrapped); next += 1
                }
                let latex = body.joined(separator: "\n")
                if !latex.isEmpty && latex.utf8.count <= 16_384 {
                    output.append(prefix + XgentMathFormula(source: latex, display: true).markdown)
                    index = next; continue
                }
                if closed { output.append(line); index += 1; continue }
            }
            output.append(inline(line, renderKey: renderKey)); index += 1
        }
        return output.joined(separator: "\n")
    }

    private static func containerPrefix(_ line: String) -> String {
        var index = line.startIndex, spaces = 0
        while index < line.endIndex {
            if line[index] == " " && spaces < 3 { spaces += 1; index = line.index(after: index) }
            else if line[index] == ">" {
                spaces = 0; index = line.index(after: index)
                if index < line.endIndex && line[index] == " " { index = line.index(after: index) }
            } else { break }
        }
        return String(line[..<index])
    }

    static func inline(_ source: String, renderKey: String? = nil) -> String {
        let characters = Array(source)
        var output = "", index = 0
        while index < characters.count {
            if characters[index] == "\\", index + 1 < characters.count {
                output += String(characters[index...index + 1]); index += 2; continue
            }
            if characters[index] == "`" {
                let count = run(characters, index, "`")
                if let closing = closingRun(characters, start: index + count, marker: "`", count: count) {
                    output += String(characters[index..<closing + count]); index = closing + count; continue
                }
                output += String(characters[index..<index + count]); index += count; continue
            }
            if characters[index] == "!", let fallback = imageFallback(characters, at: index) {
                // Ordinary transcript images are alt text on the shared UI.
                // Leaving a failed remote image request in MarkdownUI's task
                // group would also discard successful math in that paragraph.
                for character in fallback.label {
                    if "\\`*_{}[]<>!#|".contains(character) { output.append("\\") }
                    output.append(character)
                }
                index = fallback.end; continue
            }
            if characters[index] == "]", index + 1 < characters.count, characters[index + 1] == "(" {
                var next = index + 2, depth = 1
                while next < characters.count && depth > 0 {
                    if characters[next] == "\\" { next += min(2, characters.count - next); continue }
                    if characters[next] == "(" { depth += 1 }
                    if characters[next] == ")" { depth -= 1 }
                    next += 1
                }
                output += String(characters[index..<next]); index = next; continue
            }
            if characters[index] == "$" {
                let count = run(characters, index, "$")
                if count >= 2, let closing = closingRun(characters, start: index + count, marker: "$", count: count) {
                    var latex = String(characters[index + count..<closing])
                    // The shared inline parser removes one surrounding space
                    // when the content contains data, preserving other spaces.
                    if latex.first == " ", latex.last == " ", !latex.trimmingCharacters(in: .whitespaces).isEmpty {
                        latex.removeFirst(); latex.removeLast()
                    }
                    if !latex.isEmpty && latex.utf8.count <= 16_384 {
                        output += XgentMathFormula(source: latex, display: false).markdown(renderKey: renderKey)
                        index = closing + count; continue
                    }
                }
                output += String(characters[index..<index + count]); index += count; continue
            }
            output.append(characters[index]); index += 1
        }
        return output
    }

    private static func imageFallback(_ source: [Character], at start: Int) -> (label: String, end: Int)? {
        guard start + 1 < source.count, source[start + 1] == "[" else { return nil }
        var index = start + 2, depth = 1, label = ""
        while index < source.count {
            let character = source[index]
            if character == "\\", index + 1 < source.count {
                label.append(source[index + 1]); index += 2; continue
            }
            if character == "[" { depth += 1 }
            if character == "]" { depth -= 1; if depth == 0 { break } }
            label.append(character); index += 1
        }
        guard index + 1 < source.count, depth == 0, source[index + 1] == "(" else { return nil }
        index += 2; depth = 1
        while index < source.count && depth > 0 {
            if source[index] == "\\" { index += min(2, source.count - index); continue }
            if source[index] == "(" { depth += 1 }
            if source[index] == ")" { depth -= 1 }
            index += 1
        }
        guard depth == 0 else { return nil }
        return (label.trimmingCharacters(in: .whitespaces), index)
    }

    private static func run(_ source: [Character], _ start: Int, _ marker: Character) -> Int {
        var end = start
        while end < source.count && source[end] == marker { end += 1 }
        return end - start
    }
    private static func closingRun(_ source: [Character], start: Int, marker: Character, count: Int) -> Int? {
        var index = start
        while index < source.count {
            if source[index] == marker {
                let length = run(source, index, marker)
                if length == count { return index }
                index += length
            } else { index += 1 }
        }
        return nil
    }
}
