import Foundation
import XCTest

extension XCTestCase {
    @MainActor
    func attachNativeAccessibilityEvidence<T: Encodable>(_ hierarchy: T, name: String) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.nonConformingFloatEncodingStrategy = .convertToString(
            positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        let attachment = XCTAttachment(string: String(decoding: try encoder.encode(hierarchy), as: UTF8.self))
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
