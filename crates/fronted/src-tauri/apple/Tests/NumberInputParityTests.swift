import Foundation
import XCTest
@testable import XgentNativeUI

final class NumberInputParityTests: XCTestCase {
    private struct Example: Decodable {
        let input: String
        let min: Double
        let max: Double?
        let integer: Bool?
        let clearable: Bool?
        let decision: String
        let value: Double?
        let clamped: Bool?
    }

    func testTheSameWholeDraftCorpusAsTheActualAstryxCommitEngine() throws {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle(for: Self.self)
        #endif
        let url = try XCTUnwrap(bundle.url(forResource: "number-input", withExtension: "json", subdirectory: "Fixtures") ??
                                bundle.url(forResource: "number-input", withExtension: "json"))
        let examples = try JSONDecoder().decode([Example].self, from: Data(contentsOf: url))
        for example in examples {
            let limits = try XCTUnwrap(XgentNumberInputConstraints(minimum: example.min, maximum: example.max, step: 1, allowsUnboundedMaximum: true))
            var draft = XgentNumberInputDraft(); draft.pending = example.input
            let result = draft.decision(limits: limits, integerOnly: example.integer == true, clearable: example.clearable == true)
            switch result {
            case .revert: XCTAssertEqual(example.decision, "revert", example.input)
            case .clear: XCTAssertEqual(example.decision, "clear", example.input)
            case .number(let value, let clamped):
                XCTAssertEqual(example.decision, "commit", example.input)
                XCTAssertEqual(value, try XCTUnwrap(example.value), example.input)
                XCTAssertEqual(clamped, example.clamped ?? false, example.input)
            }
        }
    }

    func testEditsPreservePartialTextAndExternalUpdatesUntilAnExplicitBoundary() throws {
        let limits = try XCTUnwrap(XgentNumberInputConstraints(minimum: 5, maximum: 3600, step: 1))
        var draft = XgentNumberInputDraft()
        XCTAssertEqual(draft.display(value: 300, focused: false), "300")
        XCTAssertEqual(draft.display(value: 0.000001, focused: false), "0.000001")
        XCTAssertEqual(draft.display(value: 0.0000001, focused: false), "1e-7")
        XCTAssertEqual(draft.display(value: 1e21, focused: false), "1e+21")
        for input in ["", "-", "1e", "1,23", "13.", "13.5"] {
            draft.pending = input
            XCTAssertEqual(draft.display(value: 900, focused: true), input)
        }
        draft.pending = "13.5"
        XCTAssertEqual(draft.commit(blur: false, limits: limits, integerOnly: false, clearable: false), .number(13.5, clamped: false))
        XCTAssertEqual(draft.pending, "13.5", "Enter leaves an unclamped valid draft editable")
        XCTAssertEqual(draft.commit(blur: true, limits: limits, integerOnly: false, clearable: false), .number(13.5, clamped: false))
        XCTAssertNil(draft.pending)
        draft.pending = "-"
        XCTAssertEqual(draft.commit(blur: false, limits: limits, integerOnly: false, clearable: false), .revert)
        XCTAssertEqual(draft.pending, "-")
        _ = draft.commit(blur: true, limits: limits, integerOnly: false, clearable: false)
        XCTAssertEqual(draft.display(value: 900, focused: false), "900")
        draft.pending = "1"
        XCTAssertEqual(draft.commit(blur: false, limits: limits, integerOnly: false, clearable: false), .number(5, clamped: true))
        XCTAssertNil(draft.pending)
    }

    func testEmptyOptionalValuesAndUnboundedMaximumAreNotReplacedWithArtificialLimits() throws {
        let limits = try XCTUnwrap(XgentNumberInputConstraints(minimum: 0, maximum: nil, step: 1, allowsUnboundedMaximum: true))
        var draft = XgentNumberInputDraft(); draft.pending = ""
        XCTAssertEqual(draft.decision(limits: limits, integerOnly: true, clearable: true), .clear)
        XCTAssertEqual(draft.decision(limits: limits, integerOnly: true, clearable: false), .revert)
        draft.pending = "10000000"
        XCTAssertEqual(draft.decision(limits: limits, integerOnly: true, clearable: true), .number(10000000, clamped: false))
        XCTAssertEqual(XgentNumberInputStep.next(nil, direction: -1, limits: limits, integerOnly: true), 0)
        XCTAssertEqual(XgentNumberInputStep.next(nil, direction: 1, limits: limits, integerOnly: true), 0)
        XCTAssertNil(XgentNumberInputConstraints(minimum: 0, maximum: nil, step: 1))
    }

    func testSteppingAlignsWithTheGridRatherThanAddingToAnOffGridValue() throws {
        let limits = try XCTUnwrap(XgentNumberInputConstraints(minimum: 0, maximum: 10, step: 0.1))
        XCTAssertEqual(XgentNumberInputStep.next(0.15, direction: 1, limits: limits, integerOnly: false), 0.2)
        XCTAssertEqual(XgentNumberInputStep.next(0.15, direction: -1, limits: limits, integerOnly: false), 0.1)
        XCTAssertEqual(XgentNumberInputStep.next(0.3, direction: 1, limits: limits, integerOnly: false), 0.4)
        XCTAssertEqual(XgentNumberInputStep.next(10, direction: 1, limits: limits, integerOnly: false), 10)
        let fractional = try XCTUnwrap(XgentNumberInputConstraints(minimum: 0.5, maximum: 9.5, step: 1))
        var draft = XgentNumberInputDraft(); draft.pending = "0"
        XCTAssertEqual(draft.decision(limits: fractional, integerOnly: true, clearable: false), .number(1, clamped: true))
    }
}
