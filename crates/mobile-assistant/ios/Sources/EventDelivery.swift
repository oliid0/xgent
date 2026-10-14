import BackgroundTasks
import Foundation
import Tauri
import UIKit
import XgentResultReceiverBridge

private struct EventDeliveryArgs: Decodable {
    let databasePath: String
    let hostId: String
    let enabled: Bool
}
private struct NativeEventIntake: Encodable {
    let events: [HealthChangeEvent]
    let healthReads: [EventHealthReadResult]
    let homeEvents: [HomeChangeEvent]
}
private final class BackgroundEventRun {
    private let lock = NSLock()
    private var cancelled = false
    private let deadline = ProcessInfo.processInfo.systemUptime + 18
    var stopped: Bool { lock.lock(); defer { lock.unlock() }; return cancelled || ProcessInfo.processInfo.systemUptime >= deadline }
    var remaining: TimeInterval { max(0, deadline - ProcessInfo.processInfo.systemUptime) }
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
}
private final class EventAttempt<Value> {
    let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var result: Result<Value, Error>?
    func finish(_ value: Result<Value, Error>) { lock.lock(); result = value; lock.unlock(); semaphore.signal() }
    func value() -> Result<Value, Error>? { lock.lock(); defer { lock.unlock() }; return result }
}

/// Separate native event sender. Its scope file contains no cookies, keys,
/// health samples or prompts. The actual protected vault remains native-only.
enum EventDelivery {
    private static let identifier = "xgent.event.refresh.v1"
    private static let queue = DispatchQueue(label: "xgent.event.delivery")
    private static let registrationLock = NSLock()
    private static var attempted = false
    private static var registered = false
    private static var observer: NSObjectProtocol?

    static func registerEarly() -> Int32 {
        guard Thread.isMainThread else { return 0 }
        registrationLock.lock(); defer { registrationLock.unlock() }
        if attempted { return registered ? 1 : 0 }
        attempted = true
        registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: queue) { handle($0) }
        if registered {
            observer = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                object: nil, queue: nil) { _ in kick() }
        }
        return registered ? 1 : 0
    }
    private static func isRegistered() -> Bool { registrationLock.lock(); defer { registrationLock.unlock() }; return registered }
    private static func file() throws -> URL {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw ResultDeliveryStorage.failure("Private event scope storage unavailable")
        }
        return support.appendingPathComponent("xgent-event-delivery/scope.json")
    }
    private static func readScope() throws -> ResultDeliveryScope? {
        let path = try file()
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        let data = try Data(contentsOf: path)
        guard data.count <= 8192 else { throw ResultDeliveryStorage.failure("Original event scope exceeds bounds") }
        let scope = try JSONDecoder().decode(ResultDeliveryScope.self, from: data)
        let database = URL(fileURLWithPath: scope.databasePath).standardizedFileURL.resolvingSymlinksInPath()
        let root = URL(fileURLWithPath: NSHomeDirectory()).standardizedFileURL.resolvingSymlinksInPath()
        guard scope.version == 1, UUID(uuidString: scope.hostId)?.uuidString.lowercased() == scope.hostId,
              database.path == scope.databasePath, database.path.hasPrefix(root.path + "/"), database.lastPathComponent == "config.sqlite" else {
            throw ResultDeliveryStorage.failure("Original private event installation changed")
        }
        return scope
    }
    private static func load() throws -> ResultDeliveryScope? {
        guard let scope = try readScope() else { return nil }
        guard scope.native({ xgent_event_scope_v1($0, $1, $2, 1) }) == 1 else {
            throw ResultDeliveryStorage.failure("Original native event scope is no longer enabled")
        }
        return scope
    }
    static func configure(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(EventDeliveryArgs.self)
        queue.async {
            do {
                guard isRegistered() else { throw ResultDeliveryStorage.failure("Early OS event registration unavailable") }
                let path = URL(fileURLWithPath: args.databasePath).standardizedFileURL.resolvingSymlinksInPath().path
                let scope = ResultDeliveryScope(version: 1, databasePath: path, hostId: args.hostId)
                guard scope.native({ xgent_event_scope_v1($0, $1, $2, args.enabled ? 1 : 0) }) == 1 else {
                    throw ResultDeliveryStorage.failure("Original native event configuration changed")
                }
                if let prior = try readScope(), prior != scope {
                    throw ResultDeliveryStorage.failure("Retained event scope cannot adopt another installation")
                }
                if !args.enabled {
                    let path = try file()
                    if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
                    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
                    invoke.resolve(true); return
                }
                let path = try file(); var directory = path.deletingLastPathComponent()
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try directory.setResourceValues(values)
                try JSONEncoder().encode(scope).write(to: path, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                let handle = try FileHandle(forWritingTo: path); try handle.synchronize(); try handle.close()
                try schedule()
                invoke.resolve(true)
            } catch { invoke.reject(error.localizedDescription) }
        }
    }
    private static func schedule() throws {
        guard isRegistered(), try load() != nil else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier); return
        }
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try BGTaskScheduler.shared.submit(request)
    }
    static func kick() { queue.async { try? schedule() } }
    private static func retry() {
        guard isRegistered() else { return }
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
    private static func handle(_ task: BGTask) {
        guard task is BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
        let run = BackgroundEventRun(); task.expirationHandler = { run.cancel() }
        var success = false
        defer {
            do { try schedule() } catch { success = false; retry() }
            task.setTaskCompleted(success: success && !run.stopped)
        }
        do {
            guard let scope = try load() else { success = true; return }
            let read = EventAttempt<[HealthChangeEvent]>()
            HealthEventObserver.shared.nativePending(read.finish)
            guard read.semaphore.wait(timeout: .now() + min(2, run.remaining)) == .success,
                  let readResult = read.value(), !run.stopped else { return }
            let events: [HealthChangeEvent]
            var observationReady = true
            switch readResult {
            case .success(let observed): events = observed
            case .failure: events = []; observationReady = false
            }
            let payload = String(data: try JSONEncoder().encode(events), encoding: .utf8) ?? ""
            guard payload.utf8.count <= 16384 else { return }
            let scopesReply = scope.native { path, root, host in payload.withCString {
                xgent_event_health_scopes_v1(path, root, host, $0)
            } }
            guard let scopesReply else { return }
            defer { xgent_release_result(scopesReply) }
            let scopesRaw = String(cString: scopesReply)
            guard scopesRaw.utf8.count <= 16384, let scopesData = scopesRaw.data(using: .utf8), !run.stopped else { return }
            let scopes = try JSONDecoder().decode([EventHealthReadScope].self, from: scopesData)
            guard scopes.count <= 4 else { return }
            var healthReads: [EventHealthReadResult] = []
            for healthScope in scopes {
                if run.stopped { return }
                let observed = EventAttempt<EventHealthPayload>()
                let attempt = HealthEventObserver.shared.readNative(healthScope, complete: observed.finish)
                if observed.semaphore.wait(timeout: .now() + min(2, run.remaining)) == .success,
                   let result = observed.value(), case .success(let actual) = result, !run.stopped {
                    healthReads.append(EventHealthReadResult(scope: healthScope, result: actual))
                } else { observationReady = false }
                attempt.cancel()
            }
            var homeEvents: [HomeChangeEvent] = []
            do { homeEvents = try HomeEventBuffer.pending(host: scope.hostId) }
            catch { observationReady = false }
            let intake = String(data: try JSONEncoder().encode(NativeEventIntake(events: events, healthReads: healthReads,homeEvents: homeEvents)), encoding: .utf8) ?? ""
            guard intake.utf8.count <= 160 * 1024, !run.stopped else { return }
            let context = Unmanaged.passRetained(run).toOpaque()
            defer { Unmanaged<BackgroundEventRun>.fromOpaque(context).release() }
            let reply = scope.native { path, root, host in intake.withCString { metadata in
                xgent_event_sync_v1(path, root, host, metadata, { context in
                    guard let context else { return 1 }
                    return Unmanaged<BackgroundEventRun>.fromOpaque(context).takeUnretainedValue().stopped ? 1 : 0
                }, context)
            } }
            guard let reply else { return }
            defer { xgent_release_result(reply) }
            let raw = String(cString: reply)
            guard raw.utf8.count <= 2 * 1024 * 1024,
                  let data = raw.data(using: .utf8), let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  value["version"] as? Int == 1, value["hostId"] as? String == scope.hostId,
                  let ids = value["acknowledgedEventIds"] as? [String], Set(ids).count == ids.count,
                  ids.allSatisfy({ id in events.contains { $0.id == id } }),
                  let homeIds = value["acknowledgedHomeEventIds"] as? [String], homeIds.count <= 16,
                  Set(homeIds).count == homeIds.count, homeIds.allSatisfy({ id in homeEvents.contains { $0.id == id } }),
                  let targets = value["targets"] as? [[String: Any]], targets.count <= 2 else { return }
            try HomeEventBuffer.acknowledge(homeIds,host: scope.hostId)
            let ack = EventAttempt<Void>()
            HealthEventObserver.shared.acknowledgeNative(ids, complete: ack.finish)
            guard ack.semaphore.wait(timeout: .now() + min(2, run.remaining)) == .success,
                  let ackResult = ack.value() else { return }
            try ackResult.get()
            if !targets.isEmpty {
                let stored = EventAttempt<Void>()
                ResultDelivery.acceptEventTargets(scope, targets: targets, complete: stored.finish)
                guard stored.semaphore.wait(timeout: .now() + min(2, run.remaining)) == .success,
                      let storedResult = stored.value() else { return }
                try storedResult.get()
            }
            success = observationReady && (value["success"] as? Bool) == true && !run.stopped
        } catch { success = false }
    }
}

@_cdecl("xgent_event_delivery_register_v1")
func registerEventDeliveryEarly() -> Int32 { EventDelivery.registerEarly() }
