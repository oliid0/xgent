import Foundation

struct XgentCodeSyntaxStyle: Decodable, Equatable {
    let color: String
    let fontStyle: Int
    var valid: Bool {
        (0...15).contains(fontStyle) && color.range(of: #"^#[0-9a-fA-F]{6}$"#, options: .regularExpression) != nil
    }
}
struct XgentCodeSyntaxAppearance: Decodable, Equatable {
    let light: XgentCodeSyntaxStyle
    let dark: XgentCodeSyntaxStyle
}
struct XgentCodeSyntaxConfiguration: Decodable, Equatable {
    let source: String
    let languageId: String
    let revision: Int
    let styles: [XgentCodeSyntaxAppearance]
    // Compact UTF-16 [start, length, appearance] runs from the shared lexer.
    let runs: [[Int]]

    static func decode(_ text: String?) -> Self? {
        struct Metadata: Decodable { let syntax: XgentCodeSyntaxConfiguration? }
        guard let text, let value = try? JSONDecoder().decode(Metadata.self, from: Data(text.utf8)).syntax,
              value.revision > 0, !value.languageId.isEmpty,
              value.styles.allSatisfy({ $0.light.valid && $0.dark.valid }),
              XgentCodeSyntaxIndex(value) != nil else { return nil }
        return value
    }
}
