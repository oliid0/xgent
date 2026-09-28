import Foundation
import LanguageSupport
import XCTest
@testable import XgentNativeUI

final class CodeEditorLanguageTests: XCTestCase {
    func testFileLanguagesUseTheActualKeywordStringAndNumberTokenisers() throws {
        for (language, source, keyword, literal) in [
            (" .SWIFT ", "let message = \"Hello\"; let count = 42", "let", "\"Hello\""),
            ("pyi", "return \"Hello\" + 42", "return", "\"Hello\""),
            ("sql", "SELECT 'Hello', 42", "SELECT", "'Hello'"),
        ] {
            let configuration = XgentCodeLanguages.configuration(language)
            let tokeniser = try XCTUnwrap(LanguageConfiguration.Tokeniser(
                for: configuration.tokenDictionary,
                caseInsensitiveReservedIdentifiers: configuration.caseInsensitiveReservedIdentifiers))
            let tokens = source.tokenise(with: tokeniser, state: .tokenisingCode)
            for (text, expected) in [(keyword, LanguageConfiguration.Token.keyword), (literal, .string), ("42", .number)] {
                let range = (source as NSString).range(of: text)
                XCTAssertEqual(tokens.first(where: { $0.range == range })?.token, expected, language)
            }
        }
    }

    func testAllSupportedFileGrammarsCompileAndUnknownLanguagesRemainEditableText() throws {
        for language in ["swift", "python", "sqlite", "haskell", "agda", "cabal", "cypher", "unknown"] {
            let configuration = XgentCodeLanguages.configuration(language)
            XCTAssertNotNil(LanguageConfiguration.Tokeniser(for: configuration.tokenDictionary,
                caseInsensitiveReservedIdentifiers: configuration.caseInsensitiveReservedIdentifiers))
        }
        let plain = XgentCodeLanguages.configuration("unknown")
        let tokeniser = try XCTUnwrap(LanguageConfiguration.Tokeniser(for: plain.tokenDictionary))
        XCTAssertTrue("Plain text 你好".tokenise(with: tokeniser, state: .tokenisingCode).isEmpty)
    }
}
