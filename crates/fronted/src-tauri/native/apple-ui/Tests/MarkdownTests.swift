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
        for prefix in ["", "  ", "\t", "\n\n\t  "] {
            let code = prefix + "let text = \"\u{4F60}\u{597D} \u{1F44B}\"\n\t// comment\n"
            for dark in [false, true] {
                let result = XgentSwiftHighlighter(dark: dark).attributedCode(code, language: "SWIFT")
                XCTAssertEqual(result.string, code)
                XCTAssertNotNil(result.attribute(.foregroundColor, at: prefix.utf16.count, effectiveRange: nil))
            }
        }
    }

    func testEmptyAndWhitespaceOnlySwiftRemainVerbatim() {
        for code in ["", "  ", "\n\t\r\n"] {
            XCTAssertEqual(XgentSwiftHighlighter(dark: false).attributedCode(code, language: "swift").string, code)
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
