import Foundation
import XCTest
@testable import XgentNativeUI

final class CodeLocationTests: XCTestCase {
    func testLocationsClampLinesAndUTF16ColumnsAcrossAllCommonLineEndings() throws {
        let text = "First\r\n😀中文\rLast\n"
        let location = try XCTUnwrap(XgentCodeLocation.decode(#"{"request":"1","line":2,"column":3,"endLine":3}"#))
        let range = location.range(in: text)
        XCTAssertEqual((text as NSString).substring(with: range), "中文\rLast")
        XCTAssertEqual(XgentCodeLocation(request: "2", line: 99, endLine: nil, column: 99).range(in: text), NSRange(location: text.utf16.count, length: 0))
        let end = XgentCodeLocation(request: "3", line: 2, endLine: 1, column: 99).range(in: text)
        XCTAssertEqual(end, NSRange(location: 11, length: 0))
    }

    func testEmptyTextAndSurrogateBoundariesProduceValidNativeSelections() {
        XCTAssertEqual(XgentCodeLocation(request: "1", line: 1, endLine: nil, column: nil).range(in: ""), NSRange(location: 0, length: 0))
        let range = XgentCodeLocation(request: "2", line: 1, endLine: nil, column: 2).range(in: "😀 tail")
        XCTAssertEqual(range.location, 0)
        XCTAssertEqual(("😀 tail" as NSString).substring(with: range), "😀 tail")
    }

    func testMalformedOrNonpositiveLocationsAreNotNavigationCommands() {
        for value in [nil, "invalid", #"{"request":"","line":1}"#, #"{"request":"1","line":0}"#,
                      #"{"request":"1","line":1,"column":0}"#, #"{"request":"1","line":1,"endLine":-1}"#] as [String?] {
            XCTAssertNil(XgentCodeLocation.decode(value))
        }
    }
}
