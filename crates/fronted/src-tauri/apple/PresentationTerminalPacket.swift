import Foundation

struct XgentTerminalPacket: Decodable {
    let sessionId: String
    let generation: Int
    let startOffset: Int
    let endOffset: Int
    let bytes: String
    let enabled: Bool

    static func decode(_ value: String) -> (Self, [UInt8])? {
        guard value.utf8.count <= 400_000,
              let packet = try? JSONDecoder().decode(Self.self, from: Data(value.utf8)),
              !packet.sessionId.isEmpty, packet.generation >= 0,
              packet.startOffset >= 0, packet.endOffset >= packet.startOffset,
              packet.endOffset <= 9_007_199_254_740_991,
              let bytes = Data(base64Encoded: packet.bytes), bytes.count <= 256 * 1024,
              bytes.count == packet.endOffset - packet.startOffset else { return nil }
        return (packet, Array(bytes))
    }
}

enum XgentTerminalEvent: Encodable {
    case input(sessionId: String, bytes: Data)
    case resize(sessionId: String, cols: Int, rows: Int)

    private enum Keys: String, CodingKey { case sessionId, type, bytes, cols, rows }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case .input(let sessionId, let bytes):
            try container.encode(sessionId, forKey: .sessionId)
            try container.encode("input", forKey: .type)
            try container.encode(bytes.base64EncodedString(), forKey: .bytes)
        case .resize(let sessionId, let cols, let rows):
            try container.encode(sessionId, forKey: .sessionId)
            try container.encode("resize", forKey: .type)
            try container.encode(cols, forKey: .cols)
            try container.encode(rows, forKey: .rows)
        }
    }

    var payload: String? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
