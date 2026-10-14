import CryptoKit
import Foundation
import Security
import XgentResultReceiverBridge

struct ResultDeliveryScope: Codable, Equatable {
    let version: Int
    let databasePath: String
    let hostId: String

    func native<T>(_ call: (UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>) throws -> T) rethrows -> T {
        try databasePath.withCString { path in
            try NSHomeDirectory().withCString { root in
                try hostId.withCString { host in try call(path, root, host) }
            }
        }
    }
}

/// Private original scope metadata and encrypted task-only read credentials.
/// All access is serialized by ResultDelivery.queue; never replace a corrupt
/// configuration or create a new identity/database in response to a read.
enum ResultDeliveryStorage {
    private static let maxBytes = 2 * 1024 * 1024
    private static let service = "xgent.result.read.v1"
    static func failure(_ message: String) -> NSError {
        NSError(domain: "xgent.result.delivery", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    private static func folder() throws -> URL {
        guard let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw failure("Private result storage is unavailable")
        }
        return root.appendingPathComponent("xgent-result-delivery", isDirectory: true)
    }
    private static func read(_ url: URL, limit: Int) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var data = Data()
        while data.count <= limit {
            let next = try handle.read(upToCount: min(65536, limit + 1 - data.count)) ?? Data()
            if next.isEmpty { break }
            data.append(next)
        }
        guard !data.isEmpty, data.count <= limit else { throw failure("Retained result configuration exceeds its limit") }
        return data
    }
    private static func write(_ data: Data, to url: URL) throws {
        var directory = try folder()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        try data.write(to: url, options: [.atomic, .completeUntilFirstUserAuthentication])
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.synchronize()
    }
    static func load() throws -> ResultDeliveryScope? {
        let url = try folder().appendingPathComponent("scope.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let scope = try JSONDecoder().decode(ResultDeliveryScope.self, from: read(url, limit: 8192))
        try validate(scope)
        return scope
    }
    private static func validate(_ scope: ResultDeliveryScope) throws {
        let path = URL(fileURLWithPath: scope.databasePath).standardizedFileURL.resolvingSymlinksInPath()
        let root = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
        guard scope.version == 1, UUID(uuidString: scope.hostId)?.uuidString.lowercased() == scope.hostId,
              path.path == scope.databasePath, path.path.hasPrefix(root.path + "/"), path.lastPathComponent == "config.sqlite" else {
            throw failure("Result delivery requires the original private installation")
        }
        // This opens only the existing native DB and verifies its exact owner.
        _ = try retained(scope, targets: "[]")
    }
    static func configure(databasePath: String, hostId: String) throws -> ResultDeliveryScope {
        let path = URL(fileURLWithPath: databasePath).standardizedFileURL.resolvingSymlinksInPath().path
        let scope = ResultDeliveryScope(version: 1, databasePath: path, hostId: hostId)
        try validate(scope)
        if let prior = try load() {
            guard prior == scope else { throw failure("Retained result delivery cannot adopt another installation") }
        } else {
            try write(JSONEncoder().encode(scope), to: folder().appendingPathComponent("scope.json"))
        }
        return scope
    }
    private static func key(_ scope: ResultDeliveryScope, create: Bool) throws -> SymmetricKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: scope.hostId,
            kSecAttrSynchronizable as String: false]
        var lookup = query; lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecSuccess {
            guard let bytes = result as? Data, bytes.count == 32 else { throw failure("Original result read key is invalid") }
            return SymmetricKey(data: bytes)
        }
        guard status == errSecItemNotFound, create else { throw failure("Original result read key is unavailable") }
        let generated = SymmetricKey(size: .bits256)
        let bytes = generated.withUnsafeBytes { Data($0) }
        var item = query; item[kSecValueData as String] = bytes
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw failure("Result read key was not persisted") }
        return generated
    }
    private static func aad(_ scope: ResultDeliveryScope) -> Data {
        Data("xgent.result.read.v1\u{0}\(scope.hostId)\u{0}\(scope.databasePath)".utf8)
    }
    static func targets(_ scope: ResultDeliveryScope) throws -> String {
        let url = try folder().appendingPathComponent("targets.enc")
        guard FileManager.default.fileExists(atPath: url.path) else { return "[]" }
        let sealed = try AES.GCM.SealedBox(combined: read(url, limit: maxBytes))
        let bytes = try AES.GCM.open(sealed, using: key(scope, create: false), authenticating: aad(scope))
        guard bytes.count <= maxBytes, let raw = String(data: bytes, encoding: .utf8) else { throw failure("Retained result targets are invalid") }
        return raw
    }
    static func saveTargets(_ scope: ResultDeliveryScope, raw: String) throws {
        let bytes = Data(raw.utf8)
        guard bytes.count <= maxBytes - 64 else { throw failure("Retained result targets exceed their limit") }
        guard let data = try AES.GCM.seal(bytes, using: key(scope, create: true), authenticating: aad(scope)).combined else {
            throw failure("Result credentials were not sealed")
        }
        try write(data, to: folder().appendingPathComponent("targets.enc"))
    }
    static func retained(_ scope: ResultDeliveryScope, targets: String) throws -> String {
        let reply = scope.native { path, root, host in targets.withCString { xgent_result_targets_v1(path, root, host, $0) } }
        guard let reply else { throw failure("Original native result bindings are unavailable") }
        defer { xgent_release_result(reply) }
        return String(cString: reply)
    }
    static func pending(_ scope: ResultDeliveryScope) throws -> [String] {
        let reply = scope.native { xgent_result_pending_v1($0, $1, $2) }
        guard let reply else { throw failure("Original native result notices are unavailable") }
        defer { xgent_release_result(reply) }
        return try JSONDecoder().decode([String].self, from: Data(String(cString: reply).utf8))
    }
}
