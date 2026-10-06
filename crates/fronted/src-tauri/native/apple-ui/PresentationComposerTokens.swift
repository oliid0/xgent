import Foundation

// Ranges come from the shared rich draft, never from matching displayed text.
// Native caret/key handling can therefore recognize repeated labels and emoji
// without interpreting a file, Skill, commit or pasted-text reference itself.
enum XgentComposerTokens {
    private struct Token: Decodable {
        let location: Int
        let length: Int
    }

    static func range(for key: String, caret: NSRange, text: String, encoded: String) -> NSRange? {
        guard ["left", "right", "backspace", "delete"].contains(key),
              caret.length == 0, caret.location >= 0, caret.location <= text.utf16.count,
              let data = encoded.data(using: .utf8),
              let tokens = try? JSONDecoder().decode([Token].self, from: data) else { return nil }
        let backward = key == "left" || key == "backspace"
        for token in tokens {
            guard token.location >= 0, token.length > 0,
                  token.location <= text.utf16.count,
                  token.length <= text.utf16.count - token.location else { return nil }
            let end = token.location + token.length
            let matches = backward
                ? caret.location > token.location && caret.location <= end
                : caret.location >= token.location && caret.location < end
            if matches {
                let range = NSRange(location: token.location, length: token.length)
                return Range(range, in: text) == nil ? nil : range
            }
        }
        return nil
    }
}
