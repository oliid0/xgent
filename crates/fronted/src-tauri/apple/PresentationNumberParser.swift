import Foundation

// Handwritten native parsing follows the installed NumberInput's whole-draft
// grammar. NumberFormatter supplies locale symbols, never lenient prefix parsing.
struct XgentNumberParser {
    let symbols: XgentNumberSymbols
    init(locale: String = "en") { symbols = .init(locale: locale) }

    private func trim(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private func digits(_ text: String) -> Bool { text.utf8.allSatisfy { (48...57).contains($0) } }
    private func currency(_ text: String) -> String {
        var result = trim(text)
        if result.unicodeScalars.first?.properties.generalCategory == .currencySymbol {
            result = trim(String(result.dropFirst()))
        }
        if result.unicodeScalars.last?.properties.generalCategory == .currencySymbol {
            result = trim(String(result.dropLast()))
        }
        return result
    }

    private func read(_ core: String, group: String, decimal: String, primary: Int, secondary: Int, minGroups: Int) -> String? {
        var integer = core
        var fraction: String?
        if !decimal.isEmpty, core.contains(decimal) {
            let parts = core.components(separatedBy: decimal)
            guard parts.count == 2, digits(parts[1]) else { return nil }
            integer = parts[0]; fraction = parts[1]
        }
        var result: String
        if !group.isEmpty, integer.contains(group) {
            let parts = integer.components(separatedBy: group)
            guard parts.count - 1 >= minGroups, parts.allSatisfy({ !$0.isEmpty && digits($0) }),
                  let first = parts.first, let last = parts.last,
                  first.count <= secondary, last.count == primary,
                  parts.dropFirst().dropLast().allSatisfy({ $0.count == secondary }) else { return nil }
            result = parts.joined()
        } else {
            guard digits(integer) else { return nil }
            result = integer
        }
        guard !result.isEmpty || fraction?.isEmpty == false else { return nil }
        if let fraction { result += "." + fraction }
        return result
    }

    private func plain(_ core: String) -> String? {
        let alphabet = Set("0123456789,.' ’٫٬")
        guard !core.isEmpty, core.allSatisfy(alphabet.contains) else { return nil }
        if let result = read(core, group: symbols.group, decimal: symbols.decimal,
                             primary: symbols.primary, secondary: symbols.secondary, minGroups: 1) { return result }
        if let range = core.range(of: #"^(?:[0-9]+\.?[0-9]*|\.[0-9]+)$"#, options: .regularExpression),
           range == core.startIndex..<core.endIndex { return core }
        // Preserve encounter order: some valid pasted formats have two readings.
        var separators: [String] = []
        for character in core where !digits(String(character)) {
            let separator = String(character)
            if !separators.contains(separator) { separators.append(separator) }
        }
        guard !separators.isEmpty, separators.count <= 2 else { return nil }
        for candidate in separators {
            let minimum = [" ", "'", "’"].contains(candidate) ? 1 : 2
            guard core.components(separatedBy: candidate).count - 1 >= minimum else { continue }
            let other = separators.first { $0 != candidate } ?? ""
            if !other.isEmpty, core.components(separatedBy: other).count != 2 { continue }
            if let result = read(core, group: candidate, decimal: other, primary: 3, secondary: 3, minGroups: minimum) { return result }
        }
        return nil
    }

    func parse(_ source: String) -> Double? {
        var normalized = ""
        for scalar in source.precomposedStringWithCompatibilityMapping.unicodeScalars {
            let code = scalar.value
            if (0x200B...0x200F).contains(code) || (0x2066...0x2069).contains(code) || code == 0x061C || code == 0xFEFF { continue }
            if scalar.properties.generalCategory == .decimalNumber {
                guard let digit = Character(String(scalar)).wholeNumberValue, (0...9).contains(digit) else { return nil }
                normalized += String(digit)
            } else { normalized.unicodeScalars.append(scalar) }
        }
        var rest = trim(normalized), sign = 1.0
        let accounting = rest.hasPrefix("(") && rest.hasSuffix(")")
        if accounting { sign = -1; rest = trim(String(rest.dropFirst().dropLast())) }
        rest = currency(rest)
        let signs = Set("+−‒–-")
        var writtenSign = false
        if let character = rest.first, signs.contains(character) {
            writtenSign = true; if character != "+" { sign = -sign }
            rest = trim(String(rest.dropFirst()))
        } else if let character = rest.last, signs.contains(character) {
            writtenSign = true; if character != "+" { sign = -sign }
            rest = trim(String(rest.dropLast()))
        }
        guard !accounting || !writtenSign else { return nil }
        rest = currency(rest)
        var exponent = 0.0
        let expression = try! NSRegularExpression(pattern: #"\s*[eE]\s*([+-]?[0-9]+)$"#)
        let text = rest as NSString
        if let match = expression.firstMatch(in: rest, range: NSRange(location: 0, length: text.length)) {
            guard let parsed = Double(text.substring(with: match.range(at: 1))) else { return nil }
            exponent = parsed; rest = text.substring(to: match.range.location)
        }
        guard let plain = plain(trim(rest)), let magnitude = Double(plain), magnitude.isFinite else { return nil }
        var scaled = magnitude
        if exponent != 0 {
            scaled *= pow(10, exponent)
            guard scaled.isFinite else { return nil }
            // Match the shared parser's 15-significant-digit exponent rounding.
            let rounded = String(format: "%.15g", locale: Locale(identifier: "en_US_POSIX"), scaled)
            guard let value = Double(rounded) else { return nil }
            scaled = value
        }
        guard scaled.isFinite else { return nil }
        return scaled == 0 ? 0 : sign * scaled
    }
}
