import Foundation

struct XgentCodeHostSessions: Decodable {
    let scope: String
    let open: [String]
    let revision: Int
    static func decode(_ node: XgentNode) -> Self? {
        struct Metadata: Decodable { let editorSessions: XgentCodeHostSessions }
        guard node.kind == .chatLayout, let text = node.text,
              let value = try? JSONDecoder().decode(Metadata.self, from: Data(text.utf8)).editorSessions,
              !value.scope.isEmpty, value.revision > 0, value.open.allSatisfy({ !$0.isEmpty }),
              Set(value.open).count == value.open.count else { return nil }
        return value
    }
}
