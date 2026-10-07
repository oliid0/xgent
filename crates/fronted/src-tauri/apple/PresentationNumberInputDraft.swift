import Foundation

enum XgentNumberCommit: Equatable {
    case revert
    case clear
    case number(Double, clamped: Bool)
}

struct XgentNumberInputDraft {
    var pending: String?
    let parser = XgentNumberParser()

    func display(value: Double?, focused: Bool) -> String {
        pending ?? value.map { focused ? parser.symbols.editable($0) : XgentNumberSymbols().editable($0) } ?? ""
    }

    func parsed(limits: XgentNumberInputConstraints, integerOnly: Bool) -> Double? {
        guard let pending, let value = parser.parse(pending),
              !integerOnly || value.rounded() == value, limits.range.contains(value) else { return nil }
        return value
    }

    func decision(limits: XgentNumberInputConstraints, integerOnly: Bool, clearable: Bool) -> XgentNumberCommit {
        guard let pending else { return .revert }
        if pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return clearable ? .clear : .revert }
        guard let value = parser.parse(pending), !integerOnly || value.rounded() == value else { return .revert }
        let minimum = integerOnly ? ceil(limits.range.lowerBound) : limits.range.lowerBound
        let maximum = integerOnly ? floor(limits.range.upperBound) : limits.range.upperBound
        guard minimum <= maximum else { return .revert }
        let bounded = min(maximum, max(minimum, value))
        return .number(bounded, clamped: bounded != value)
    }

    mutating func commit(blur: Bool, limits: XgentNumberInputConstraints, integerOnly: Bool, clearable: Bool) -> XgentNumberCommit {
        let result = decision(limits: limits, integerOnly: integerOnly, clearable: clearable)
        if blur { pending = nil }
        else if case .number(_, clamped: true) = result { pending = nil }
        return result
    }
}
