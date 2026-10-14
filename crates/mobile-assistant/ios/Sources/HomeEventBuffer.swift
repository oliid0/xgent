import Foundation
import Tauri

struct HomeChangeEvent: Codable {
    let id: String
    let homeId: String
    let accessoryId: String
    let serviceId: String
    let characteristicId: String
    let homeNamePreview: String
    let accessoryNamePreview: String
    let serviceNamePreview: String
    let power: Bool
    let occurredAtMs: Int64
}
struct HomeEventConfiguration: Decodable {
    let hostId: String
    let homes: [String]
    let authorize: Bool
}
struct HomeEventSource: Encodable { let id: String; let name: String }
private struct HomeEventAcknowledgement: Decodable { let ids: [String] }
private struct HomeEventState: Codable {
    let version: Int
    let hostId: String
    var homes: [String]
    var pending: [HomeChangeEvent]
}

/// Only actual HomeKit notifications write this buffer. A saved observation
/// grants no permission to read or control another home/device.
enum HomeEventBuffer {
    private static let lock = NSLock()
    private static var observationError: Error?
    private static func file() throws -> URL {
        guard let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw ResultDeliveryStorage.failure("Home event storage unavailable")
        }
        return root.appendingPathComponent("xgent-home-events/state.json")
    }
    private static func read() throws -> HomeEventState? {
        let path = try file()
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        let data = try Data(contentsOf: path)
        guard data.count <= 32768 else { throw ResultDeliveryStorage.failure("Home event buffer exceeds bounds") }
        let state = try JSONDecoder().decode(HomeEventState.self, from: data)
        guard state.version == 1, UUID(uuidString: state.hostId)?.uuidString.lowercased() == state.hostId,
              state.homes.count <= 20, Set(state.homes).count == state.homes.count,
              state.homes.allSatisfy({ UUID(uuidString: $0)?.uuidString.lowercased() == $0 }),
              state.pending.count <= 16, Set(state.pending.map { $0.id }).count == state.pending.count,
              state.pending.allSatisfy({ event in
                  state.homes.contains(event.homeId) && event.occurredAtMs > 0 &&
                  [event.homeNamePreview,event.accessoryNamePreview,event.serviceNamePreview].allSatisfy({ $0.unicodeScalars.count <= 64 }) &&
                  [event.id,event.homeId,event.accessoryId,event.serviceId,event.characteristicId].allSatisfy({ UUID(uuidString: $0)?.uuidString.lowercased() == $0 })
              }) else { throw ResultDeliveryStorage.failure("Invalid original Home event state") }
        return state
    }
    private static func save(_ state: HomeEventState) throws {
        let path = try file(); var directory = path.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        try JSONEncoder().encode(state).write(to: path, options: [.atomic,.completeFileProtectionUntilFirstUserAuthentication])
        let handle = try FileHandle(forWritingTo: path); try handle.synchronize(); try handle.close()
    }
    static func retainedHomes(_ host: String) throws -> [String] {
        lock.lock(); defer { lock.unlock() }
        guard let state = try read() else { return [] }
        guard state.hostId == host else { throw ResultDeliveryStorage.failure("Original Home event installation changed") }
        return state.homes
    }
    static func configure(_ host: String, homes: [String]) throws {
        lock.lock(); defer { lock.unlock() }
        let prior = try read()
        guard prior == nil || prior?.hostId == host else { throw ResultDeliveryStorage.failure("Home event scope cannot adopt another installation") }
        if prior?.homes == homes { return }
        if prior == nil && homes.isEmpty { return }
        let pending = (prior?.pending ?? []).filter { homes.contains($0.homeId) }
        try save(HomeEventState(version: 1,hostId: host,homes: homes,pending: pending))
        if homes.isEmpty { observationError = nil }
    }
    static func record(_ event: HomeChangeEvent, host: String) throws {
        lock.lock(); defer { lock.unlock() }
        do {
            guard var state = try read(), state.hostId == host, state.homes.contains(event.homeId) else { return }
            // Coalesce only undelivered values of this exact characteristic. ACK
            // loss cannot erase a newer callback because its event UUID is new.
            state.pending.removeAll { $0.characteristicId == event.characteristicId }
            guard state.pending.count < 16 else { throw ResultDeliveryStorage.failure("Home event buffer is full; observation was not retained") }
            state.pending.append(event)
            try save(state); observationError = nil
        } catch { observationError = error; throw error }
    }
    static func pending(host: String? = nil) throws -> [HomeChangeEvent] {
        lock.lock(); defer { lock.unlock() }
        if let observationError { throw observationError }
        guard let state = try read() else { return [] }
        guard host == nil || state.hostId == host else { throw ResultDeliveryStorage.failure("Original Home event installation changed") }
        return state.pending
    }
    static func acknowledge(_ ids: [String], host: String? = nil) throws {
        lock.lock(); defer { lock.unlock() }
        guard ids.count <= 16, Set(ids).count == ids.count, ids.allSatisfy({ UUID(uuidString: $0)?.uuidString.lowercased() == $0 }) else {
            throw ResultDeliveryStorage.failure("Invalid Home event acknowledgement")
        }
        guard var state = try read() else { return }
        guard host == nil || state.hostId == host else { throw ResultDeliveryStorage.failure("Original Home event installation changed") }
        state.pending.removeAll { ids.contains($0.id) }
        try save(state)
    }
    static func pending(_ invoke: Invoke) {
        do { invoke.resolve(try pending()) } catch { invoke.reject(error.localizedDescription) }
    }
    static func acknowledge(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(HomeEventAcknowledgement.self)
        do { try acknowledge(args.ids); invoke.resolve() } catch { invoke.reject(error.localizedDescription) }
    }
}
