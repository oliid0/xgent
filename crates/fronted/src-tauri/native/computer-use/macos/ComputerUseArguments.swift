import CoreFoundation
import Foundation

func normalizedElementIndexArgument(_ value: Any?) -> String? {
    guard let value else { return nil }
    if let number = value as? NSNumber, CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() { return nil }
    if let string = value as? String { return string.isEmpty ? nil : string }
    if let integer = value as? Int { return String(integer) }
    guard let number = value as? Double, let integer = Int(exactly: number) else { return nil }
    return String(integer)
}

func computerUsePositiveInteger(_ value: Any, key: String, expectedDescription: String = "a positive integer") throws -> Int {
    if let number = value as? NSNumber, CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() {
        throw ComputerUseError.invalidArguments("\(key) must be \(expectedDescription)")
    }
    let integer: Int
    if let exact = value as? Int {
        integer = exact
    } else if let number = value as? Double, let exact = Int(exactly: number) {
        integer = exact
    } else {
        // Double(Int.max) rounds up to 2^63 on 64-bit platforms. A comparison
        // against that rounded bound followed by Int(value) traps the process.
        throw ComputerUseError.invalidArguments("\(key) must be \(expectedDescription) within the supported integer range")
    }
    guard integer > 0 else {
        throw ComputerUseError.invalidArguments("\(key) must be \(expectedDescription)")
    }
    return integer
}
