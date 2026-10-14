import Foundation
import HomeKit
import Tauri

private struct HomeInventoryArgs: Decodable {
    let limit: Int
    let homeId: String?
}

private struct HomeInventoryRecord: Encodable {
    let kind: String
    let id: String
    let homeId: String
    let name: String
    let roomId: String?
    let reachable: Bool?
    let powerControls: [HomePowerControl]
}

private struct HomePowerControl: Encodable { let id: String; let serviceId: String; let name: String }
private struct HomePowerArgs: Decodable {
    let homeId: String; let accessoryId: String; let serviceId: String; let characteristicId: String; let power: Bool
}
private struct HomePowerDestination: Encodable { let id: String; let sourceId: String; let source: String }
private struct HomePowerReceipt: Encodable { let id: String; let presented = false; let detail: String }

private struct HomeInventoryPayload: Encodable {
    let source: String
    let observedAtMs: Int64
    let records: [HomeInventoryRecord]
    let truncated: Bool
}

/// A single manager, created by explicit authorization or restoration of this
/// installation's explicit observer scope. Status checks never create it.
final class HomeKitAccess: NSObject, HMHomeManagerDelegate, HMAccessoryDelegate {
    private var manager: HMHomeManager?
    private var loaded = false
    private var pending: [UUID: (ready: () -> Void, timeout: DispatchWorkItem)] = [:]
    private var startedPowerRequests = Set<UUID>()
    private var eventHost: String?
    private var eventTargets: [String: (HMHome,HMAccessory,HMService,HMCharacteristic)] = [:]
    private var eventConfiguration: UUID?

    var available: Bool {
        !(Bundle.main.object(forInfoDictionaryKey: "NSHomeKitUsageDescription") as? String ?? "").isEmpty
    }

    var permissionState: String {
        guard let manager else { return "prompt" }
        let status = manager.authorizationStatus
        if status.contains(.restricted) { return "denied" }
        if status.contains(.authorized) { return "granted" }
        return status.contains(.determined) ? "denied" : "prompt"
    }

    func request(_ invoke: Invoke, completion: @escaping () -> Void) {
        DispatchQueue.main.async {
            guard self.available else { invoke.reject("HomeKit is not configured in this app"); return }
            self.wait(invoke, seconds: 60) { id in
                guard self.permissionState != "prompt" else { return }
                self.finish(id, completion)
            }
            if self.manager == nil {
                let manager = HMHomeManager()
                self.manager = manager
                manager.delegate = self
            }
            self.flush()
        }
    }

    func list(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(HomeInventoryArgs.self)
        guard (1...200).contains(args.limit) else { invoke.reject("Home inventory limit must be 1–200"); return }
        let selected: UUID?
        if let id = args.homeId {
            guard let parsed = UUID(uuidString: id) else { invoke.reject("homeId must be a HomeKit UUID"); return }
            selected = parsed
        } else { selected = nil }
        DispatchQueue.main.async {
            guard self.manager != nil, self.permissionState == "granted" else {
                invoke.reject("HomeKit permission is required; explicitly authorize Home access first"); return
            }
            self.wait(invoke, seconds: 15) { id in
                guard self.permissionState == "granted" else {
                    self.finish(id) { invoke.reject("HomeKit permission was revoked") }; return
                }
                guard self.loaded, let manager = self.manager else { return }
                let homes = selected.map { selected in manager.homes.filter { $0.uniqueIdentifier == selected } } ?? manager.homes
                guard selected == nil || !homes.isEmpty else {
                    self.finish(id) { invoke.reject("The requested HomeKit home is no longer accessible") }; return
                }
                var records: [HomeInventoryRecord] = []
                var truncated = false
                var powerControlCount = 0
                func append(_ kind: String, _ uuid: UUID, _ home: UUID, _ name: String, room: UUID? = nil, reachable: Bool? = nil, power: [HomePowerControl] = []) {
                    guard records.count < args.limit else { truncated = true; return }
                    if name.count > 512 { truncated = true }
                    records.append(HomeInventoryRecord(kind: kind, id: uuid.uuidString.lowercased(),
                        homeId: home.uuidString.lowercased(), name: String(name.prefix(512)),
                        roomId: room?.uuidString.lowercased(), reachable: reachable, powerControls: power))
                }
                // Stable UUID order; names never identify the target. A global
                // record limit bounds payload size even for a large home.
                for home in homes.sorted(by: { $0.uniqueIdentifier.uuidString < $1.uniqueIdentifier.uuidString }) {
                    if records.count >= args.limit { truncated = true; break }
                    append("home", home.uniqueIdentifier, home.uniqueIdentifier, home.name)
                    for room in home.rooms.sorted(by: { $0.uniqueIdentifier.uuidString < $1.uniqueIdentifier.uuidString }) {
                        append("room", room.uniqueIdentifier, home.uniqueIdentifier, room.name)
                    }
                    for accessory in home.accessories.sorted(by: { $0.uniqueIdentifier.uuidString < $1.uniqueIdentifier.uuidString }) {
                        var power: [HomePowerControl] = []
                        for service in accessory.services.sorted(by: { $0.uniqueIdentifier.uuidString < $1.uniqueIdentifier.uuidString }) {
                            for characteristic in service.characteristics.sorted(by: { $0.uniqueIdentifier.uuidString < $1.uniqueIdentifier.uuidString }) where
                                characteristic.characteristicType == HMCharacteristicTypePowerState &&
                                characteristic.properties.contains(HMCharacteristicPropertyWritable) &&
                                characteristic.properties.contains(HMCharacteristicPropertyReadable) {
                                if power.count == 8 || powerControlCount == 128 { truncated = true; break }
                                power.append(HomePowerControl(id: characteristic.uniqueIdentifier.uuidString.lowercased(),
                                    serviceId: service.uniqueIdentifier.uuidString.lowercased(), name: String(service.name.prefix(512))))
                                powerControlCount += 1
                            }
                        }
                        append("accessory", accessory.uniqueIdentifier, home.uniqueIdentifier, accessory.name,
                            room: accessory.room?.uniqueIdentifier, reachable: accessory.isReachable, power: power)
                    }
                    for scene in home.actionSets.sorted(by: { $0.uniqueIdentifier.uuidString < $1.uniqueIdentifier.uuidString }) {
                        append("scene", scene.uniqueIdentifier, home.uniqueIdentifier, scene.name)
                    }
                }
                self.finish(id) {
                    invoke.resolve(HomeInventoryPayload(source: "homekit", observedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
                        records: records, truncated: truncated))
                }
            }
            self.flush()
        }
    }

    private func powerTarget(_ args: HomePowerArgs) throws -> (HMHome, HMAccessory, HMCharacteristic) {
        guard [args.homeId,args.accessoryId,args.serviceId,args.characteristicId].allSatisfy({ value in
            UUID(uuidString: value)?.uuidString.lowercased() == value
        }) else { throw NSError(domain: "HomeKitAccess", code: 1, userInfo: [NSLocalizedDescriptionKey: "Home power requires exact observed HomeKit UUIDs"]) }
        guard loaded, permissionState == "granted", let manager,
            let home = manager.homes.first(where: { $0.uniqueIdentifier.uuidString.lowercased() == args.homeId }),
            let accessory = home.accessories.first(where: { $0.uniqueIdentifier.uuidString.lowercased() == args.accessoryId }),
            let service = accessory.services.first(where: { $0.uniqueIdentifier.uuidString.lowercased() == args.serviceId }),
            let characteristic = service.characteristics.first(where: { $0.uniqueIdentifier.uuidString.lowercased() == args.characteristicId }),
            characteristic.characteristicType == HMCharacteristicTypePowerState,
            characteristic.properties.contains(HMCharacteristicPropertyWritable),
            characteristic.properties.contains(HMCharacteristicPropertyReadable), accessory.isReachable
        else { throw NSError(domain: "HomeKitAccess", code: 2, userInfo: [NSLocalizedDescriptionKey: "The authorized Home power target is unavailable or no longer writable"]) }
        return (home,accessory,characteristic)
    }

    /// Metadata preflight only. Rust commits the immutable claim before setPower.
    func resolvePower(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(HomePowerArgs.self)
        DispatchQueue.main.async {
            guard self.manager != nil, self.permissionState == "granted" else { invoke.reject("Explicit HomeKit authorization is required"); return }
            self.wait(invoke, seconds: 15) { id in
                guard self.loaded else { return }
                do {
                    let (home,_,characteristic) = try self.powerTarget(args)
                    self.finish(id) { invoke.resolve(HomePowerDestination(id: characteristic.uniqueIdentifier.uuidString.lowercased(),
                        sourceId: home.uniqueIdentifier.uuidString.lowercased(), source: String(home.name.prefix(512)))) }
                } catch { self.finish(id) { invoke.reject(error.localizedDescription) } }
            }
            self.flush()
        }
    }

    /// Private Rust-only write, after the persistent effect claim. A fresh SDK
    /// read, not its cached value, must confirm the requested state.
    func setPower(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(HomePowerArgs.self)
        DispatchQueue.main.async {
            guard self.manager != nil, self.permissionState == "granted" else { invoke.reject("HomeKit access was revoked"); return }
            self.wait(invoke, seconds: 30) { id in
                guard self.loaded, !self.startedPowerRequests.contains(id) else { return }
                self.startedPowerRequests.insert(id)
                do {
                    let (_,_,characteristic) = try self.powerTarget(args)
                    func confirm() {
                        guard self.pending[id] != nil else { return }
                        characteristic.readValue { error in
                            DispatchQueue.main.async {
                                guard self.pending[id] != nil else { return }
                                if let error { self.finish(id) { invoke.reject(error.localizedDescription) }; return }
                                do {
                                    let (_,_,current) = try self.powerTarget(args)
                                    guard current === characteristic, let value = current.value as? NSNumber,
                                        (value.doubleValue == 0 || value.doubleValue == 1), value.boolValue == args.power
                                    else { throw NSError(domain: "HomeKitAccess", code: 3, userInfo: [NSLocalizedDescriptionKey: "HomeKit did not confirm the requested power state"]) }
                                    self.finish(id) { invoke.resolve(HomePowerReceipt(id: args.characteristicId, detail: args.power ? "Power on confirmed" : "Power off confirmed")) }
                                } catch { self.finish(id) { invoke.reject(error.localizedDescription) } }
                            }
                        }
                    }
                    characteristic.readValue { error in
                        DispatchQueue.main.async {
                            guard self.pending[id] != nil else { return }
                            if let error { self.finish(id) { invoke.reject(error.localizedDescription) }; return }
                            do {
                                let (_,_,current) = try self.powerTarget(args)
                                guard current === characteristic, let value = current.value as? NSNumber,
                                    (value.doubleValue == 0 || value.doubleValue == 1)
                                else { throw NSError(domain: "HomeKitAccess", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid HomeKit power observation"]) }
                                if value.boolValue == args.power { confirm(); return }
                                characteristic.writeValue(NSNumber(value: args.power)) { error in
                                    DispatchQueue.main.async {
                                        guard self.pending[id] != nil else { return }
                                        if let error { self.finish(id) { invoke.reject(error.localizedDescription) }; return }
                                        confirm()
                                    }
                                }
                            } catch { self.finish(id) { invoke.reject(error.localizedDescription) } }
                        }
                    }
                } catch { self.finish(id) { invoke.reject(error.localizedDescription) } }
            }
            self.flush()
        }
    }

    func eventSources(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard self.permissionState == "granted", self.loaded, let manager = self.manager else { invoke.resolve([HomeEventSource]()); return }
            let sources = manager.homes.sorted(by: { $0.uniqueIdentifier.uuidString < $1.uniqueIdentifier.uuidString }).filter { home in
                let count = home.accessories.flatMap { $0.services }.flatMap { $0.characteristics }.filter { characteristic in
                    characteristic.characteristicType == HMCharacteristicTypePowerState && characteristic.properties.contains(HMCharacteristicPropertyReadable) &&
                    characteristic.properties.contains(HMCharacteristicPropertySupportsEventNotification)
                }.count
                return count > 0 && count <= 16
            }.prefix(20).map { HomeEventSource(id: $0.uniqueIdentifier.uuidString.lowercased(),name: String($0.name.prefix(512))) }
            invoke.resolve(sources)
        }
    }

    private func eventTargetStillPresent(_ target: (HMHome,HMAccessory,HMService,HMCharacteristic)) -> Bool {
        manager?.homes.contains(where: { $0 === target.0 && $0.accessories.contains(where: {
            $0 === target.1 && $0.services.contains(where: { $0 === target.2 && $0.characteristics.contains(where: { $0 === target.3 }) })
        }) }) == true
    }

    func configureEvents(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(HomeEventConfiguration.self)
        guard UUID(uuidString: args.hostId)?.uuidString.lowercased() == args.hostId,
              args.homes.count <= 20, Set(args.homes).count == args.homes.count,
              args.homes.allSatisfy({ UUID(uuidString: $0)?.uuidString.lowercased() == $0 }) else {
            invoke.reject("Invalid original Home event scope"); return
        }
        DispatchQueue.main.async {
            guard self.eventConfiguration == nil else { invoke.reject("Home observation setup is busy"); return }
            do {
                let prior = try HomeEventBuffer.retainedHomes(args.hostId)
                if args.homes.isEmpty {
                    try HomeEventBuffer.configure(args.hostId,homes: [])
                    let previous = self.eventTargets; self.eventTargets.removeAll(); self.eventHost = args.hostId
                    previous.values.forEach { $0.3.enableNotification(false) { _ in } }
                    invoke.resolve([String]()); return
                }
                guard args.authorize || args.homes.allSatisfy({ prior.contains($0) }) else {
                    invoke.reject("Home observation requires an explicit rule configuration"); return
                }
                if self.manager == nil {
                    // Restore only previously explicit scopes on this same
                    // installation; this never selects another Home account.
                    let manager = HMHomeManager(); self.manager = manager; manager.delegate = self
                }
                self.wait(invoke,seconds: 15) { id in
                    guard self.eventConfiguration == nil else { return }
                    guard self.permissionState == "granted" else {
                        if self.permissionState == "denied" { self.finish(id) { invoke.reject("HomeKit permission unavailable") } }
                        return
                    }
                    guard self.loaded, let manager = self.manager else { return }
                    var targets: [String: (HMHome,HMAccessory,HMService,HMCharacteristic)] = [:]
                    for homeId in args.homes {
                        guard let home = manager.homes.first(where: { $0.uniqueIdentifier.uuidString.lowercased() == homeId }) else {
                            self.finish(id) { invoke.reject("Selected Home is no longer accessible") }; return
                        }
                        for accessory in home.accessories { for service in accessory.services { for characteristic in service.characteristics where
                            characteristic.characteristicType == HMCharacteristicTypePowerState &&
                            characteristic.properties.contains(HMCharacteristicPropertyReadable) &&
                            characteristic.properties.contains(HMCharacteristicPropertySupportsEventNotification) {
                            targets[characteristic.uniqueIdentifier.uuidString.lowercased()] = (home,accessory,service,characteristic)
                        } } }
                    }
                    guard !targets.isEmpty, targets.count <= 16 else {
                        self.finish(id) { invoke.reject("Home observation needs 1–16 notifying power characteristics") }; return
                    }
                    self.eventConfiguration = id
                    let group = DispatchGroup(); var failure: Error?
                    for target in targets.values {
                        target.1.delegate = self
                        if target.3.isNotificationEnabled { continue }
                        group.enter()
                        target.3.enableNotification(true) { error in DispatchQueue.main.async {
                            if let error { failure = error }
                            group.leave()
                        } }
                    }
                    group.notify(queue: .main) {
                        guard self.eventConfiguration == id else { return }
                        defer { self.eventConfiguration = nil }
                        guard self.pending[id] != nil, failure == nil, self.permissionState == "granted",
                              targets.values.allSatisfy({ $0.3.isNotificationEnabled && self.eventTargetStillPresent($0) }),
                              manager.homes.filter({ args.homes.contains($0.uniqueIdentifier.uuidString.lowercased()) }).count == args.homes.count else {
                            targets.values.filter { self.eventTargets[$0.3.uniqueIdentifier.uuidString.lowercased()] == nil }.forEach { $0.3.enableNotification(false) { _ in } }
                            self.finish(id) { invoke.reject(failure?.localizedDescription ?? "Home observation changed or was not confirmed") }; return
                        }
                        do {
                            try HomeEventBuffer.configure(args.hostId,homes: args.homes.sorted())
                            let previous = self.eventTargets
                            self.eventTargets = targets; self.eventHost = args.hostId
                            previous.filter { targets[$0.key] == nil }.values.forEach { $0.3.enableNotification(false) { _ in } }
                            self.finish(id) { invoke.resolve(args.homes.sorted()) }
                        } catch { self.finish(id) { invoke.reject(error.localizedDescription) } }
                    }
                }
                self.flush()
            } catch { invoke.reject(error.localizedDescription) }
        }
    }

    func accessory(_ accessory: HMAccessory, service: HMService, didUpdateValueFor characteristic: HMCharacteristic) {
        DispatchQueue.main.async {
            let id = characteristic.uniqueIdentifier.uuidString.lowercased()
            guard self.permissionState == "granted", let host = self.eventHost,
                  let target = self.eventTargets[id], target.1 === accessory, target.2 === service, target.3 === characteristic,
                  self.eventTargetStillPresent(target),
                  let value = characteristic.value as? NSNumber, value.doubleValue == 0 || value.doubleValue == 1 else { return }
            do {
                try HomeEventBuffer.record(HomeChangeEvent(id: UUID().uuidString.lowercased(),homeId: target.0.uniqueIdentifier.uuidString.lowercased(),
                    accessoryId: accessory.uniqueIdentifier.uuidString.lowercased(),serviceId: service.uniqueIdentifier.uuidString.lowercased(),
                    characteristicId: id,homeNamePreview: target.0.name.unicodeScalars.prefix(64).map { String($0) }.joined(),
                    accessoryNamePreview: accessory.name.unicodeScalars.prefix(64).map { String($0) }.joined(),
                    serviceNamePreview: service.name.unicodeScalars.prefix(64).map { String($0) }.joined(),power: value.boolValue,
                    occurredAtMs: Int64(Date().timeIntervalSince1970 * 1000)),host: host)
                EventDelivery.kick()
            } catch { NSLog("Home event persistence failed: %@",error.localizedDescription) }
        }
    }

    private func wait(_ invoke: Invoke, seconds: Double, ready: @escaping (UUID) -> Void) {
        guard pending.count < 16 else { invoke.reject("Too many pending HomeKit requests"); return }
        let id = UUID()
        let timeout = DispatchWorkItem { [weak self] in
            self?.finish(id) { invoke.reject("HomeKit authorization or initial data loading timed out; retry explicitly") }
        }
        pending[id] = (ready: { ready(id) }, timeout: timeout)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: timeout)
    }

    private func finish(_ id: UUID, _ completion: () -> Void) {
        guard let request = pending.removeValue(forKey: id) else { return }
        startedPowerRequests.remove(id)
        request.timeout.cancel()
        completion()
    }

    private func flush() {
        // Copy callbacks because completion removes an entry. Late delegate
        // callbacks cannot resolve a timed-out Invoke a second time.
        for request in Array(pending.values) { request.ready() }
    }

    func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {
        DispatchQueue.main.async {
            guard self.manager === manager else { return }
            self.loaded = true
            self.flush()
        }
    }

    func homeManager(_ manager: HMHomeManager, didUpdate status: HMHomeManagerAuthorizationStatus) {
        DispatchQueue.main.async {
            guard self.manager === manager else { return }
            if self.permissionState == "denied" { self.loaded = false }
            self.flush()
        }
    }
}
