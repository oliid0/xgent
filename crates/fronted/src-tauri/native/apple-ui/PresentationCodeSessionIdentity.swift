import Foundation

struct XgentCodeSessionIdentity: Decodable, Equatable {
    let scope: String
    let key: String
    let open: [String]

    static func decode(_ text: String?) -> Self? {
        struct Metadata: Decodable { let session: XgentCodeSessionIdentity }
        guard let text, let session = try? JSONDecoder().decode(Metadata.self, from: Data(text.utf8)).session,
              !session.scope.isEmpty, !session.key.isEmpty, session.open.contains(session.key) else { return nil }
        return session
    }
    var cacheKey: String { "\(scope.utf8.count):\(scope)\(key)" }
}
