import Foundation
import HealthKit

struct EventHealthReadScope: Codable {
    let version: Int
    let ruleId: String
    let eventId: String
    let metric: String
    let startMs: Int64
    let endMs: Int64
    let bindingHash: String
}
struct EventHealthSample: Encodable {
    let id: String
    let startMs: Int64
    let endMs: Int64
    let value: Double
    let source: String
}
struct EventHealthPayload: Encodable {
    let metric: String
    let unit: String
    let startMs: Int64
    let endMs: Int64
    let samples: [EventHealthSample]
    let source: String
    let truncated: Bool
    let accessLimited: Bool
}
struct EventHealthReadResult: Encodable {
    let scope: EventHealthReadScope
    let result: EventHealthPayload
}

final class NativeHealthReadAttempt {
    private let lock = NSLock()
    private var cancelled = false
    private var query: HKSampleQuery?
    private let store: HKHealthStore
    init(store: HKHealthStore) { self.store = store }
    var stopped: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
    func start(_ value: HKSampleQuery) {
        lock.lock()
        if cancelled { lock.unlock(); return }
        query = value; store.execute(value); lock.unlock()
    }
    func finish() { lock.lock(); query = nil; lock.unlock() }
    func cancel() {
        lock.lock(); cancelled = true; let pending = query; query = nil; lock.unlock()
        if let pending { store.stop(pending) }
    }
}

enum NativeHealthReader {
    // Same units/conversion as the existing foreground HealthSamples endpoint.
    static func metric(_ metric: String) -> (HKQuantityType, HKUnit, String, Double)? {
        let identifier: HKQuantityTypeIdentifier
        let unit: HKUnit
        let label: String
        var multiplier = 1.0
        switch metric {
        case "heart_rate": identifier = .heartRate; unit = HKUnit.count().unitDivided(by: .minute()); label = "bpm"
        case "blood_glucose": identifier = .bloodGlucose; unit = HKUnit(from: "mg/dL"); label = "mg/dL"
        case "oxygen_saturation": identifier = .oxygenSaturation; unit = .percent(); label = "%"; multiplier = 100
        case "weight": identifier = .bodyMass; unit = .gramUnit(with: .kilo); label = "kg"
        case "body_temperature": identifier = .bodyTemperature; unit = .degreeCelsius(); label = "degC"
        default: return nil
        }
        guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return nil }
        return (type, unit, label, multiplier)
    }
    static func read(_ scope: EventHealthReadScope, store: HKHealthStore, attempt: NativeHealthReadAttempt,
                     complete: @escaping (Result<EventHealthPayload, Error>) -> Void) {
        guard !attempt.stopped, HKHealthStore.isHealthDataAvailable(), let metric = metric(scope.metric) else {
            complete(.failure(ResultDeliveryStorage.failure("Original HealthKit metric unavailable"))); return
        }
        let predicate = HKQuery.predicateForSamples(withStart: Date(timeIntervalSince1970: Double(scope.startMs) / 1000),
            end: Date(timeIntervalSince1970: Double(scope.endMs) / 1000), options: [.strictStartDate, .strictEndDate])
        let query = HKSampleQuery(sampleType: metric.0, predicate: predicate, limit: 51,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]) { _, samples, error in
            defer { attempt.finish() }
            guard !attempt.stopped else { return }
            if let error { complete(.failure(error)); return }
            let quantities = (samples ?? []).compactMap { $0 as? HKQuantitySample }
            let actual = quantities.prefix(50).map { sample in EventHealthSample(id: sample.uuid.uuidString,
                startMs: Int64((sample.startDate.timeIntervalSince1970 * 1000).rounded()),
                endMs: Int64((sample.endDate.timeIntervalSince1970 * 1000).rounded()),
                value: sample.quantity.doubleValue(for: metric.1) * metric.3,
                source: sample.sourceRevision.source.bundleIdentifier) }
            complete(.success(EventHealthPayload(metric: scope.metric, unit: metric.2, startMs: scope.startMs,
                endMs: scope.endMs, samples: actual, source: "healthkit", truncated: quantities.count > 50, accessLimited: true)))
        }
        // Admission is serialized with cancellation, before SDK execution.
        attempt.start(query)
    }
}
