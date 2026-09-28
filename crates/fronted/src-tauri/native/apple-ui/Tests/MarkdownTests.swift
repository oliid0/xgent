import Foundation
import MarkdownUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class MarkdownTests: XCTestCase {
    func testTranscriptRetainsBlockStructureAndEscapesCode() {
        let content = MarkdownContent("""
        # Result

        - [x] inspected
        - [ ] pending

        | Target | Status |
        | --- | --- |
        | iOS | ready |

        ```swift
        let value = "<script>"
        ```
        """)
        let html = content.renderHTML()
        XCTAssertTrue(html.contains("<h1>"))
        XCTAssertTrue(html.contains("<table>"))
        XCTAssertTrue(html.contains("type=\"checkbox\""))
        XCTAssertTrue(html.contains("&lt;script&gt;"))
        XCTAssertFalse(html.contains("<script>"))
    }

    func testSwiftHighlightingPreservesWhitespaceAndUnicode() {
        let code = "  let text = \"\u{4F60}\u{597D} \u{1F44B}\"\n\t// comment\n"
        for dark in [false, true] {
            let result = XgentSwiftHighlighter(dark: dark).attributedCode(code, language: "SWIFT")
            XCTAssertEqual(result.string, code)
            XCTAssertNotNil(result.attribute(.foregroundColor, at: 2, effectiveRange: nil))
        }
    }

    func testOtherLanguagesRemainPlainText() {
        let code = "const message = '<tag>';\n"
        for language in [nil, "javascript", "bash"] {
            let result = XgentSwiftHighlighter(dark: false).attributedCode(code, language: language)
            XCTAssertEqual(result.string, code)
            XCTAssertTrue(result.attributes(at: 0, effectiveRange: nil).isEmpty)
        }
    }
}
