import Foundation

struct XgentReadOnlySyntax: Decodable, Equatable {
    struct Style: Decodable, Equatable {
        let light: String
        let dark: String
        var valid: Bool {
            [light, dark].allSatisfy { $0.range(of: #"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"#, options: .regularExpression) != nil }
        }
    }
    let source: String
    let language: String
    let theme: String
    let styles: [Style]
    let runs: [[Int]]
    let baseStyle: Int
    let backgroundStyle: Int

    static func decode(_ raw: String?) -> Self? {
        guard let raw, let value = try? JSONDecoder().decode(Self.self, from: Data(raw.utf8)),
              !value.theme.isEmpty, !value.language.isEmpty, value.styles.allSatisfy(\.valid),
              value.styles.indices.contains(value.baseStyle), value.styles.indices.contains(value.backgroundStyle),
              XgentCodeSyntaxIndex(source: value.source, styleCount: value.styles.count, runs: value.runs) != nil else { return nil }
        return value
    }

    func matches(source: String, language: String, theme: String?) -> Bool {
        self.source.utf16.elementsEqual(source.utf16) && self.language == language && self.theme == theme
    }
}
