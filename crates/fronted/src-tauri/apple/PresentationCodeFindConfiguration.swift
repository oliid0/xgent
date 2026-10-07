import Foundation

struct XgentCodeFindOptions: Codable, Equatable {
    var matchCase = false
    var wholeWord = false
    var regex = false
    var selection = false
    var preserveCase = false
}

struct XgentCodeFindRange: Codable, Equatable {
    let location: Int
    let length: Int
    var range: NSRange { NSRange(location: location, length: length) }
    func valid(in text: String) -> Bool {
        location >= 0 && length >= 0 && location <= text.utf16.count && length <= text.utf16.count - location
    }
}

struct XgentCodeFindReveal: Decodable {
    let location: Int
    let length: Int
    let request: Int
    let before: String
    var selection: XgentCodeFindRange { .init(location: location, length: length) }
}

struct XgentCodeFindEdit: Decodable {
    let location: Int
    let length: Int
    let text: String
    let request: Int
    let before: String
    var selection: XgentCodeFindRange { .init(location: location, length: length) }
}

struct XgentCodeFindLabels: Decodable {
    let query, replacement, matchCase, wholeWord, regex, selection, preserveCase: String
    let next, previous, replace, replaceAll, close, invalid, rejected, noSelection: String
}

struct XgentCodeFindConfiguration: Decodable {
    let identity: String
    let open, replacing: Bool
    let query, replacement: String
    let options: XgentCodeFindOptions
    let count, current, revision: Int
    let invalid, limited, rejected: Bool
    let hasSelection: Bool
    let reveal: XgentCodeFindReveal?
    let edit: XgentCodeFindEdit?
    let decorations: XgentCodeFindDecorations?
    let labels: XgentCodeFindLabels

    static func decode(_ text: String?) -> Self? {
        struct Metadata: Decodable { let find: XgentCodeFindConfiguration }
        guard let data = text?.data(using: .utf8) else { return nil }
        return (try? JSONDecoder().decode(Metadata.self, from: data))?.find
    }
}

struct XgentCodeFindDraft: Equatable {
    var query: String
    var replacement: String
    var options: XgentCodeFindOptions
    init(_ configuration: XgentCodeFindConfiguration) {
        query = configuration.query; replacement = configuration.replacement; options = configuration.options
    }
}
