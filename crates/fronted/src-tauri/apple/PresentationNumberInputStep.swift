import Foundation

enum XgentNumberInputStep {
    private static func precision(_ number: Double) -> Int {
        let parts = String(number).lowercased().components(separatedBy: "e")
        let fraction = parts[0].components(separatedBy: ".").dropFirst().first?.count ?? 0
        return max(0, fraction - (parts.count > 1 ? Int(parts[1]) ?? 0 : 0))
    }

    static func next(_ current: Double?, direction: Int, limits: XgentNumberInputConstraints, integerOnly: Bool) -> Double? {
        guard direction == 1 || direction == -1 else { return current }
        let step = integerOnly && limits.step.rounded() != limits.step ? 1 : limits.step
        let base = integerOnly && limits.range.lowerBound.rounded() != limits.range.lowerBound ? 0 : limits.range.lowerBound
        var next: Double
        if let current {
            let position = (current - base) / step
            guard position.isFinite else { return current }
            let tolerance = Double.ulpOfOne * max(1, abs(position)) * 4
            next = base + (direction == 1 ? floor(position + tolerance) + 1 : ceil(position - tolerance) - 1) * step
        } else {
            next = direction == 1 ? limits.range.lowerBound : (limits.maximum ?? 0)
            if integerOnly { next = direction == 1 ? ceil(next) : floor(next) }
        }
        guard next.isFinite else { return current }
        let places = min(12, max(precision(step), precision(base)))
        let rounded = String(format: "%.*f", locale: Locale(identifier: "en_US_POSIX"), places, next)
        guard let value = Double(rounded), let bounded = limits.bounded(value),
              !integerOnly || bounded.rounded() == bounded else { return current }
        return bounded == 0 ? 0 : bounded
    }
}
