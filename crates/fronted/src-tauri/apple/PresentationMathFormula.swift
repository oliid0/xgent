import Foundation

struct XgentMathFormula: Equatable {
    let source: String
    let display: Bool

    var url: URL {
        let payload = Data(source.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return URL(string: "xgent-math://\(display ? "display" : "inline")/\(payload)")!
    }
    var markdown: String { "![formula](\(url.absoluteString))" }
    func markdown(renderKey: String?) -> String {
        guard let renderKey else { return markdown }
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.queryItems = [.init(name: "render", value: renderKey)]
        return "![formula](\(parts.url!.absoluteString))"
    }

    init(source: String, display: Bool) { self.source = source; self.display = display }
    init?(url: URL) {
        guard url.scheme == "xgent-math", ["display", "inline"].contains(url.host ?? ""),
              url.fragment == nil else { return nil }
        if let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems {
            guard query.count == 1, query[0].name == "render", (query[0].value?.count ?? 0) <= 200 else { return nil }
        }
        var payload = String(url.path.dropFirst()).replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload), data.count <= 16_384,
              let text = String(data: data, encoding: .utf8), !text.isEmpty else { return nil }
        self.init(source: text, display: url.host == "display")
    }

    static func block(in markdown: String) -> Self? {
        guard let start = markdown.range(of: "](xgent-math://"),
              let end = markdown[start.upperBound...].firstIndex(of: ")"),
              let url = URL(string: "xgent-math://" + String(markdown[start.upperBound..<end])) else { return nil }
        return Self(url: url)
    }
}
