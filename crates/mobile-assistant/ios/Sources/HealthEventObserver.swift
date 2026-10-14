import Foundation
import HealthKit
import Tauri

struct HealthChangeEvent: Codable {
    let id: String
    let metric: String
    let occurredAtMs: Int64
}
private struct HealthObserverState: Codable {
    var metrics: [String] = []
    var pending: [HealthChangeEvent] = []
    var stopMetrics: [String]? = nil
    var startMetrics: [String]? = nil
}
private struct HealthObserverArgs: Decodable { let metrics: [String]; let authorize: Bool }
private struct HealthObserverAck: Decodable { let ids: [String] }

/// Bounded, protected native buffer, independent of a WebView listener. Only
/// store-change metadata is retained; actual samples still use the policy gate.
final class HealthEventObserver {
    static let shared = HealthEventObserver()
    private let store = HKHealthStore()
    private let queue = DispatchQueue(label: "xgent.health.events")
    private var state = HealthObserverState()
    private var queries: [String: HKObserverQuery] = [:]
    private var registeredMetrics = Set<String>()
    private var busy = false
    private var loadError: String?
    private var observationError: String?
    private let file: URL?

    init() {
        file = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?.appendingPathComponent("xgent-health-events/state.json")
        do {
            guard let file else { throw failure("Health event storage is unavailable") }
            if FileManager.default.fileExists(atPath: file.path) {
                let data = try Data(contentsOf: file)
                guard data.count <= 16384 else { throw failure("Health event storage exceeds its bound") }
                let saved = try JSONDecoder().decode(HealthObserverState.self, from: data)
                guard valid(saved) else { throw failure("Health event storage is invalid; it was not overwritten") }
                state = saved
            }
        } catch { loadError = error.localizedDescription }
        // Tauri initializes this native plugin during application startup.
        // Recreate saved queries before depending on any JS/page listener.
        queue.async { [weak self] in self?.restoreQueries() }
    }

    private func type(_ metric: String) -> HKQuantityType? {
        let identifier: HKQuantityTypeIdentifier
        switch metric {
        case "heart_rate": identifier = .heartRate
        case "blood_glucose": identifier = .bloodGlucose
        case "oxygen_saturation": identifier = .oxygenSaturation
        case "weight": identifier = .bodyMass
        case "body_temperature": identifier = .bodyTemperature
        default: return nil
        }
        return HKObjectType.quantityType(forIdentifier: identifier)
    }
    private func failure(_ message: String) -> NSError {
        NSError(domain: "xgent.health.events", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    private func valid(_ value: HealthObserverState) -> Bool {
        value.metrics.count <= 5 && Set(value.metrics).count == value.metrics.count
            && value.metrics.allSatisfy { type($0) != nil }
            && (value.stopMetrics ?? []).count <= 5
            && (value.stopMetrics ?? []).allSatisfy { type($0) != nil }
            && (value.startMetrics ?? []).count <= 5
            && (value.startMetrics ?? []).allSatisfy { type($0) != nil }
            && value.pending.count <= 5 && Set(value.pending.map { $0.metric }).count == value.pending.count
            && value.pending.allSatisfy {
                type($0.metric) != nil && $0.occurredAtMs > 0
                    && UUID(uuidString: $0.id)?.uuidString.lowercased() == $0.id
            }
    }
    private func save(_ next: HealthObserverState) throws {
        guard let file, valid(next) else { throw failure("Health event storage is unavailable or invalid") }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let data = try JSONEncoder().encode(next)
        guard data.count <= 16384 else { throw failure("Health event storage exceeds its bound") }
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        state = next // Change memory only after atomic disk replacement succeeds.
    }
    private func restoreQueries() {
        guard loadError == nil, HKHealthStore.isHealthDataAvailable() else { return }
        for metric in state.metrics where queries[metric] == nil {
            guard let sampleType = type(metric) else { continue }
            let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, completion, error in
                guard let self else { completion(); return }
                self.queue.async {
                    if let error {
                        self.observationError = error.localizedDescription
                        self.registeredMetrics.remove(metric)
                        if let failed = self.queries.removeValue(forKey: metric) { self.store.stop(failed) }
                        return
                    }
                    guard self.state.metrics.contains(metric) else { completion(); return }
                    var next = self.state
                    // Coalesce undelivered changes for this metric. A new ID
                    // ensures an ACK for an older read cannot erase a new change.
                    next.pending.removeAll { $0.metric == metric }
                    next.pending.append(HealthChangeEvent(id: UUID().uuidString.lowercased(), metric: metric,
                        occurredAtMs: Int64(Date().timeIntervalSince1970 * 1000)))
                    do { try self.save(next); self.observationError = nil; completion(); EventDelivery.kick() }
                    catch { self.observationError = error.localizedDescription }
                }
            }
            queries[metric] = query
            store.execute(query)
        }
    }

    private func settleStops(_ completion: @escaping (Error?) -> Void) {
        let pending = Array(Set((state.stopMetrics ?? []) + (state.startMetrics ?? []))).sorted()
        guard !pending.isEmpty else { completion(nil); return }
        let group = DispatchGroup()
        var confirmed = Set<String>()
        var stopError: Error?
        for metric in pending {
            guard let sampleType = type(metric) else { continue }
            group.enter()
            store.disableBackgroundDelivery(for: sampleType) { success, error in
                self.queue.async {
                    if success && error == nil { confirmed.insert(metric); self.registeredMetrics.remove(metric) }
                    else { stopError = error ?? self.failure("HealthKit background delivery stop was not confirmed") }
                    group.leave()
                }
            }
        }
        group.notify(queue: queue) {
            var next = self.state
            next.stopMetrics = pending.filter { !confirmed.contains($0) }
            next.startMetrics = (next.startMetrics ?? []).filter { !confirmed.contains($0) }
            do { try self.save(next); completion(stopError) }
            catch { completion(error) }
        }
    }

    func configure(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(HealthObserverArgs.self)
        queue.async {
            if let error = self.loadError { invoke.reject(error); return }
            let desired = args.metrics.sorted()
            guard desired.count <= 5, Set(desired).count == desired.count,
                desired.allSatisfy({ self.type($0) != nil }) else { invoke.reject("Invalid HealthKit observation metrics"); return }
            guard !self.busy else { invoke.reject("HealthKit observation configuration is in progress"); return }
            let added = desired.filter { !self.state.metrics.contains($0) }
            if !added.isEmpty && !args.authorize {
                invoke.reject("New health observation requires an explicit create/enable authorization action"); return
            }
            if desired == self.state.metrics && Set(desired).isSubset(of: self.registeredMetrics)
                && self.observationError == nil && (self.state.stopMetrics ?? []).isEmpty && (self.state.startMetrics ?? []).isEmpty {
                self.restoreQueries(); invoke.resolve(desired); return
            }
            guard desired.isEmpty || HKHealthStore.isHealthDataAvailable() else { invoke.reject("HealthKit is unavailable"); return }
            self.busy = true
            let finish: (Error?) -> Void = { error in
                self.queue.async {
                    self.busy = false
                    if let error { invoke.reject(error.localizedDescription) } else { invoke.resolve(desired) }
                }
            }
            let register: () -> Void = {
                // Re-register previously authorized scopes after launch or an
                // observer failure. This never requests new read authorization.
                let registerMetrics = desired.filter { !self.registeredMetrics.contains($0) }
                do {
                    var prepared = self.state
                    prepared.startMetrics = registerMetrics
                    try self.save(prepared) // Retain unknown registrations before OS effects.
                } catch { finish(error); return }
                let group = DispatchGroup()
                var registrationError: Error?
                for metric in registerMetrics {
                    guard let sampleType = self.type(metric) else { continue }
                    group.enter()
                    self.store.enableBackgroundDelivery(for: sampleType, frequency: .immediate) { success, error in
                        self.queue.async {
                            if !success || error != nil { registrationError = error ?? self.failure("HealthKit background delivery was not enabled") }
                            group.leave()
                        }
                    }
                }
                group.notify(queue: self.queue) {
                    if let registrationError {
                        self.settleStops { stopError in finish(stopError ?? registrationError) }; return
                    }
                    do {
                        var next = self.state
                        let removed = self.state.metrics.filter { !desired.contains($0) }
                        next.metrics = desired
                        next.startMetrics = nil
                        next.stopMetrics = Array(Set((next.stopMetrics ?? []) + removed)).sorted()
                        try self.save(next)
                        self.registeredMetrics.formUnion(registerMetrics)
                        self.observationError = nil
                        for metric in removed {
                            if let query = self.queries.removeValue(forKey: metric) { self.store.stop(query) }
                        }
                        self.restoreQueries()
                        self.settleStops(finish)
                    } catch {
                        self.settleStops { stopError in finish(stopError ?? error) }
                    }
                }
            }
            self.settleStops { stopError in
                if let stopError { finish(stopError); return }
                if added.isEmpty { register(); return }
                let readTypes = Set(added.compactMap { self.type($0) as HKObjectType? })
                self.store.requestAuthorization(toShare: [], read: readTypes) { success, error in
                    self.queue.async {
                        guard success, error == nil else { finish(error ?? self.failure("HealthKit authorization did not complete")); return }
                        // Completion is NOT proof of read permission. Apple hides it.
                        register()
                    }
                }
            }
        }
    }

    func pending(_ invoke: Invoke) {
        queue.async {
            if let error = self.loadError { invoke.reject(error); return }
            if let error = self.observationError { invoke.reject(error); return }
            invoke.resolve(self.state.pending.sorted { $0.occurredAtMs < $1.occurredAtMs })
        }
    }
    func nativePending(_ complete: @escaping (Result<[HealthChangeEvent], Error>) -> Void) {
        queue.async {
            // An OS launch before first unlock can fail the initial protected
            // read. Retry that same file, never manufacture an empty grant.
            if self.loadError != nil, let file = self.file, FileManager.default.fileExists(atPath: file.path) {
                do {
                    let data = try Data(contentsOf: file)
                    guard data.count <= 16384 else { throw self.failure("Health event storage exceeds bounds") }
                    let saved = try JSONDecoder().decode(HealthObserverState.self, from: data)
                    guard self.valid(saved) else { throw self.failure("Original health event storage invalid") }
                    self.state = saved; self.loadError = nil
                } catch { self.loadError = error.localizedDescription }
            }
            self.restoreQueries()
            if let error = self.loadError ?? self.observationError {
                complete(.failure(self.failure(error))); return
            }
            complete(.success(self.state.pending.sorted { $0.occurredAtMs < $1.occurredAtMs }))
        }
    }
    func readNative(_ scope: EventHealthReadScope, complete: @escaping (Result<EventHealthPayload, Error>) -> Void) -> NativeHealthReadAttempt {
        let attempt = NativeHealthReadAttempt(store: store)
        queue.async {
            guard !attempt.stopped, self.loadError == nil, self.state.metrics.contains(scope.metric),
                  !(self.state.stopMetrics ?? []).contains(scope.metric), scope.version == 1,
                  scope.endMs > scope.startMs, scope.endMs - scope.startMs <= 600000,
                  scope.endMs <= Int64(Date().timeIntervalSince1970 * 1000),
                  let metric = NativeHealthReader.metric(scope.metric) else {
                complete(.failure(self.failure("Original background Health scope unavailable"))); return
            }
            self.store.getRequestStatusForAuthorization(toShare: [], read: [metric.0]) { status, error in
                self.queue.async {
                    guard !attempt.stopped, error == nil, status == .unnecessary, self.loadError == nil,
                          self.state.metrics.contains(scope.metric), !(self.state.stopMetrics ?? []).contains(scope.metric) else {
                        complete(.failure(self.failure("Original Health authorization must be handled in the app"))); return
                    }
                    // No permission request in an OS callback. 'unnecessary'
                    // does not reveal a read grant; empty samples stay limited.
                    NativeHealthReader.read(scope, store: self.store, attempt: attempt) { result in
                        self.queue.async {
                            guard !attempt.stopped, self.loadError == nil, self.state.metrics.contains(scope.metric),
                                  !(self.state.stopMetrics ?? []).contains(scope.metric) else {
                                complete(.failure(self.failure("Original Health scope changed during query"))); return
                            }
                            complete(result)
                        }
                    }
                }
            }
        }
        return attempt
    }
    func acknowledgeNative(_ ids: [String], complete: @escaping (Result<Void, Error>) -> Void) {
        queue.async {
            guard ids.count <= 5, Set(ids).count == ids.count,
                  ids.allSatisfy({ UUID(uuidString: $0)?.uuidString.lowercased() == $0 }) else {
                complete(.failure(self.failure("Invalid native health acknowledgement"))); return
            }
            // An unrelated status event may run while protected Health storage
            // is unreadable. An empty ACK must never replace that saved scope.
            if ids.isEmpty { complete(.success(())); return }
            if let error = self.loadError { complete(.failure(self.failure(error))); return }
            var next = self.state
            next.pending.removeAll { ids.contains($0.id) }
            do { try self.save(next); complete(.success(())) } catch { complete(.failure(error)) }
        }
    }
    func acknowledge(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(HealthObserverAck.self)
        guard args.ids.count <= 5, args.ids.allSatisfy({ UUID(uuidString: $0)?.uuidString.lowercased() == $0 }) else {
            invoke.reject("Invalid health event acknowledgement"); return
        }
        queue.async {
            if let error = self.loadError { invoke.reject(error); return }
            var next = self.state
            next.pending.removeAll { args.ids.contains($0.id) }
            do { try self.save(next); invoke.resolve() } catch { invoke.reject(error.localizedDescription) }
        }
    }
}
