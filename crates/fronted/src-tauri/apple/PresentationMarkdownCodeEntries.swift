import Foundation

struct XgentMarkdownCodeEntry {
    let language: String?
    let content: String

    var source: String { content.isEmpty ? "" : content + "\n" }

    static func languageName(_ fenceInfo: String?) -> String? {
        fenceInfo?.split(whereSeparator: { $0.isWhitespace }).first.map(String.init)
    }

    // Read code nodes from the existing cmark parser's escaped HTML output.
    // This is data extraction, never an HTML/WebKit rendering surface.
    static func parse(_ html: String) -> [Self] {
        guard let pattern = try? NSRegularExpression(pattern: #"<pre><code(?:\s[^>]*)?>[\s\S]*?</code></pre>"#) else { return [] }
        let source = html as NSString
        return pattern.matches(in: html, range: NSRange(location: 0, length: source.length)).compactMap { match in
            guard let data = source.substring(with: match.range).data(using: .utf8) else { return nil }
            let reader = XgentMarkdownCodeReader()
            let parser = XMLParser(data: data)
            parser.shouldResolveExternalEntities = false
            parser.delegate = reader
            guard parser.parse(), reader.hasCode else { return nil }
            let raw = reader.text
            // CodeBlockView in MarkdownUI 2.4.1 removes one final newline.
            let content = raw.hasSuffix("\n") ? String(raw.dropLast()) : raw
            return Self(language: reader.language, content: content)
        }
    }
}

private final class XgentMarkdownCodeReader: NSObject, XMLParserDelegate {
    var text = ""
    var language: String?
    var hasCode = false
    private var reading = false

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        if elementName == "code" {
            hasCode = true; reading = true
            language = attributes["class"]?.split(whereSeparator: { $0.isWhitespace })
                .first(where: { $0.hasPrefix("language-") }).map { String($0.dropFirst("language-".count)) }
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if reading { text += string }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        if elementName == "code" { reading = false }
    }
}
