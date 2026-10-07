import Foundation
import XCTest
@testable import XgentNativeUI

final class ComposerTokenTests: XCTestCase {
    func testReferenceKeysRespectUTF16BoundariesAndOrdinaryText() {
        let text = "😀 /review continue"
        let encoded = "[{\"location\":3,\"length\":7}]"
        let token = NSRange(location: 3, length: 7)
        for key in ["right", "delete"] {
            XCTAssertEqual(XgentComposerTokens.range(for: key, caret: .init(location: 3, length: 0), text: text, encoded: encoded), token)
            XCTAssertNil(XgentComposerTokens.range(for: key, caret: .init(location: 10, length: 0), text: text, encoded: encoded))
        }
        for key in ["left", "backspace"] {
            XCTAssertEqual(XgentComposerTokens.range(for: key, caret: .init(location: 10, length: 0), text: text, encoded: encoded), token)
            XCTAssertNil(XgentComposerTokens.range(for: key, caret: .init(location: 3, length: 0), text: text, encoded: encoded))
        }
        XCTAssertNil(XgentComposerTokens.range(for: "left", caret: .init(location: 15, length: 0), text: text, encoded: encoded))
        XCTAssertNil(XgentComposerTokens.range(for: "delete", caret: .init(location: 3, length: 2), text: text, encoded: encoded))
        XCTAssertEqual(XgentComposerTokens.range(for: "left", caret: .init(location: 5, length: 0), text: text, encoded: encoded), token)
    }

    func testMalformedRangesNeverInterceptNativeEditing() {
        for encoded in ["not json", "{}", "[]", "[{\"location\":-1,\"length\":3}]",
                        "[{\"location\":0,\"length\":0}]", "[{\"location\":0,\"length\":99999}]",
                        "[{\"location\":0,\"length\":1}]", "[{\"location\":1e30,\"length\":3}]"] {
            XCTAssertNil(XgentComposerTokens.range(for: "right", caret: .init(location: 0, length: 0), text: "😀", encoded: encoded))
        }
        XCTAssertNil(XgentComposerTokens.range(for: "send", caret: .init(location: 0, length: 0), text: "word", encoded: "[{\"location\":0,\"length\":4}]"))
    }
}
