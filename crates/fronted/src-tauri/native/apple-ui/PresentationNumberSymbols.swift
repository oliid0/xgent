import Foundation

// Astryx has no InternationalizationProvider in this application and therefore
// resolves numeric input as "en", independently of the device display language.
struct XgentNumberSymbols {
    let group: String
    let decimal: String
    let primary: Int
    let secondary: Int

    init(locale: String = "en") {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: locale)
        formatter.numberStyle = .decimal
        group = (formatter.groupingSeparator ?? ",").precomposedStringWithCompatibilityMapping
        decimal = formatter.decimalSeparator ?? "."
        primary = max(1, formatter.groupingSize)
        secondary = formatter.secondaryGroupingSize > 0 ? formatter.secondaryGroupingSize : primary
    }

    func editable(_ value: Double) -> String {
        var raw = value == 0 ? "0" : String(value)
        let parts = raw.lowercased().components(separatedBy: "e")
        if parts.count == 2, let exponent = Int(parts[1]) {
            var coefficient = parts[0]
            let sign = coefficient.hasPrefix("-") ? "-" : ""
            if !sign.isEmpty { coefficient.removeFirst() }
            if coefficient.hasSuffix(".0") { coefficient = String(coefficient.dropLast(2)) }
            if abs(value) >= 1e-6 && abs(value) < 1e21 {
                let point = coefficient.firstIndex(of: ".").map { coefficient.distance(from: coefficient.startIndex, to: $0) } ?? coefficient.count
                let digits = coefficient.replacingOccurrences(of: ".", with: "")
                let position = point + exponent
                if position <= 0 { raw = sign + "0." + String(repeating: "0", count: -position) + digits }
                else if position >= digits.count { raw = sign + digits + String(repeating: "0", count: position - digits.count) }
                else { raw = sign + String(digits.prefix(position)) + "." + String(digits.dropFirst(position)) }
            } else { raw = sign + coefficient + "e" + (exponent >= 0 ? "+" : "") + String(exponent) }
        } else if raw.hasSuffix(".0") { raw = String(raw.dropLast(2)) }
        return decimal == "." ? raw : raw.replacingOccurrences(of: ".", with: decimal)
    }
}
