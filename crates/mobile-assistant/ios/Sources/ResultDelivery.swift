import BackgroundTasks
import Foundation
import Tauri
import UIKit
import XgentResultReceiverBridge

private struct ResultDeliveryArgs: Decodable {
    let databasePath: String
    let hostId: String
    let targetJson: String?
}

private final class BackgroundResultRun {
    private let lock = NSLock()
    private var cancelled = false
    private let deadline = ProcessInfo.processInfo.systemUptime + 18
    var stopped: Bool {
        lock.lock(); defer { lock.unlock() }
        return cancelled || ProcessInfo.processInfo.systemUptime >= deadline
    }
    var remaining: TimeInterval { max(0, deadline - ProcessInfo.processInfo.systemUptime) }
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
}

private final class ResultNoticeAttempt {
    let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var result: Result<String, Error>?
    func finish(_ value: Result<String, Error>) {
        lock.lock(); result = value; lock.unlock(); semaphore.signal()
    }
    func value() -> Result<String, Error>? { lock.lock(); defer { lock.unlock() }; return result }
}

/// Registered once before UIApplication's launch completes. Execution and
/// encrypted scope storage do not require a plugin instance or conversation.
enum ResultDelivery {
    private static let identifier = "xgent.result.refresh.v1"
    static let queue = DispatchQueue(label: "xgent.result.delivery")
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
                object: nil, queue: nil) { _ in queue.async { try? scheduleIfNeeded() } }
        }
        return registered ? 1 : 0
    }
    private static func isRegistered() -> Bool {
        registrationLock.lock(); defer { registrationLock.unlock() }; return registered
    }
    static func configure(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ResultDeliveryArgs.self)
        queue.async {
            do {
                guard isRegistered() else { throw ResultDeliveryStorage.failure("Early OS result registration is unavailable") }
                let scope = try ResultDeliveryStorage.configure(databasePath: args.databasePath, hostId: args.hostId)
                if let update = args.targetJson, !update.isEmpty {
                    guard update.utf8.count <= 16384,
                          let target = try JSONSerialization.jsonObject(with: Data(update.utf8)) as? [String: Any],
                          let request = target["requestId"] as? String else {
                        throw ResultDeliveryStorage.failure("Invalid scoped result update")
                    }
                    let prior = try targets(try retained(scope))
                    var next = prior.filter { $0["requestId"] as? String != request }
                    next.append(target)
                    let raw = try encode(next)
                    let retained = try ResultDeliveryStorage.retained(scope, targets: raw)
                    guard try targets(retained).contains(where: { $0["requestId"] as? String == request }) else {
                        throw ResultDeliveryStorage.failure("Original native result scope was revoked during configuration")
                    }
                    try ResultDeliveryStorage.saveTargets(scope, raw: retained)
                }
                try scheduleIfNeeded()
                invoke.resolve(true)
            } catch { invoke.reject(error.localizedDescription) }
        }
    }
    private static func targets(_ raw: String) throws -> [[String: Any]] {
        guard raw.utf8.count <= 2 * 1024 * 1024,
              let values = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [[String: Any]], values.count <= 128 else {
            throw ResultDeliveryStorage.failure("Retained result scopes exceed their limit")
        }
        return values
    }
    /// Native event admission can configure only already staged exact task read
    /// grants. The separate event sender never inherits result-reader authority.
    static func acceptEventTargets(_ origin: ResultDeliveryScope, targets updates: [[String: Any]],
                                   complete: @escaping (Result<Void, Error>) -> Void) {
        queue.async {
            do {
                guard updates.count <= 2, isRegistered() else { throw ResultDeliveryStorage.failure("Original result handoff unavailable") }
                let scope = try ResultDeliveryStorage.configure(databasePath: origin.databasePath, hostId: origin.hostId)
                var next = try targets(retained(scope))
                for update in updates {
                    guard let request = update["requestId"] as? String else { throw ResultDeliveryStorage.failure("Original result request missing") }
                    next.removeAll { $0["requestId"] as? String == request }; next.append(update)
                }
                let retained = try ResultDeliveryStorage.retained(scope, targets: encode(next))
                let actual = try targets(retained)
                guard updates.allSatisfy({ update in actual.contains { ($0["requestId"] as? String) == (update["requestId"] as? String) } }) else {
                    throw ResultDeliveryStorage.failure("Original result scopes were revoked during handoff")
                }
                try ResultDeliveryStorage.saveTargets(scope, raw: retained)
                try scheduleIfNeeded()
                let acknowledgement = try encode(updates)
                guard scope.native({ path, root, host in acknowledgement.withCString { xgent_event_results_ack_v1(path, root, host, $0) } }) == 1 else {
                    throw ResultDeliveryStorage.failure("Native result setup ACK remains available for retry")
                }
                complete(.success(()))
            } catch { complete(.failure(error)) }
        }
    }
    private static func encode(_ values: [[String: Any]]) throws -> String {
        guard values.count <= 128, let raw = String(data: try JSONSerialization.data(withJSONObject: values), encoding: .utf8) else {
            throw ResultDeliveryStorage.failure("Result scope configuration was not encoded")
        }
        return raw
    }
    private static func retained(_ scope: ResultDeliveryScope) throws -> String {
        let raw = try ResultDeliveryStorage.targets(scope)
        let next = try ResultDeliveryStorage.retained(scope, targets: raw)
        if next != raw { try ResultDeliveryStorage.saveTargets(scope, raw: next) }
        return next
    }
    private static func scheduleIfNeeded() throws {
        guard isRegistered(), let scope = try ResultDeliveryStorage.load() else { return }
        let raw = try retained(scope)
        if try targets(raw).isEmpty && ResultDeliveryStorage.pending(scope).isEmpty {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        // The repository ships Xcode 26.4.1/iOS 26.0. submitTaskRequest is iOS
        // 27-only; this SDK's throwing submit API must acknowledge acceptance.
        try BGTaskScheduler.shared.submit(request)
    }
    private static func retryAfterUnavailableStorage() {
        // An already launched OS request is the authority for retrying its
        // same refresh identifier. First-unlock/keychain/DB failures must not
        // require reading protected credentials to reserve the next attempt.
        guard isRegistered() else { return }
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
    private static func drain(_ scope: ResultDeliveryScope, run: BackgroundResultRun) throws -> Bool {
        for entry in try ResultDeliveryStorage.pending(scope) {
            if run.stopped { return false }
            let status = scope.native { path, root, host in entry.withCString { xgent_result_notice_v1(path, root, host, $0, 0) } }
            if status == 2 || status == 3 { continue }
            guard status == 1 else { throw ResultDeliveryStorage.failure("Original notice identity is unavailable") }
            let attempt = ResultNoticeAttempt()
            ResultNotifications.post(entryId: entry, cancelled: { run.stopped }, completion: attempt.finish)
            guard attempt.semaphore.wait(timeout: .now() + min(2, run.remaining)) == .success,
                  let result = attempt.value(), !run.stopped else { return false }
            let receipt = try result.get()
            if receipt == "blocked" { return true } // Retain unread receipt; never ask for permission in a background task.
            guard receipt == "accepted" else { return false }
            let recorded = scope.native { path, root, host in entry.withCString { xgent_result_notice_v1(path, root, host, $0, 1) } }
            guard recorded == 2 else { throw ResultDeliveryStorage.failure("Actual OS acceptance remains available for retry") }
        }
        return !run.stopped
    }
    private static func handle(_ task: BGTask) {
        guard task is BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
        let run = BackgroundResultRun()
        task.expirationHandler = { run.cancel() }
        var success = false
        defer {
            do { try scheduleIfNeeded() } catch {
                success = false
                retryAfterUnavailableStorage()
            }
            task.setTaskCompleted(success: success && !run.stopped)
        }
        do {
            guard let scope = try ResultDeliveryStorage.load() else { success = true; return }
            let cached = (try? drain(scope, run: run)) ?? false
            guard !run.stopped else { return }
            let raw = try retained(scope)
            let context = Unmanaged.passRetained(run).toOpaque()
            defer { Unmanaged<BackgroundResultRun>.fromOpaque(context).release() }
            let received = scope.native { path, root, host in
                raw.withCString { payload in
                    xgent_result_sync_v1(path, root, host, payload, { context in
                        guard let context else { return 1 }
                        return Unmanaged<BackgroundResultRun>.fromOpaque(context).takeUnretainedValue().stopped ? 1 : 0
                    }, context)
                }
            }
            let delivered = (try? drain(scope, run: run)) ?? false
            success = cached && received == 1 && delivered
        } catch { success = false }
    }
}

// Tauri's generated main.mm calls start_app on the main thread before the
// event loop. Rust calls this symbol there, never from a late plugin init.
@_cdecl("xgent_result_delivery_register_v1")
func registerResultDeliveryEarly() -> Int32 { ResultDelivery.registerEarly() }
