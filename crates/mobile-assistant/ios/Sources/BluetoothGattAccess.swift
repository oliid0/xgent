import CoreBluetooth
import Foundation
import Tauri

private struct GattArgs: Decodable {
    let operation: String
    let deviceId: String
    let serviceUuid: String?
    let characteristicUuid: String?
    let timeoutMs: UInt64
    let durationMs: UInt64?
    let sampleLimit: Int?
}
private struct GattCharacteristic: Encodable {
    let uuid: String
    let readable: Bool
    let writable: Bool
    let notifiable: Bool
}
private struct GattService: Encodable {
    let uuid: String
    let characteristics: [GattCharacteristic]
}
private struct GattResult: Encodable {
    let deviceId: String
    let services: [GattService]
    let serviceUuid: String?
    let characteristicUuid: String?
    let dataHex: String?
    let samples: [GattSample]
    let stopReason: String?
}
private struct GattSample: Encodable {
    let receivedAtMs: Int64
    let dataHex: String
}

// Each operation owns a bounded connection. All delegates run on the main queue.
final class BluetoothGattAccess: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var pending: Invoke?
    private var args: GattArgs?
    private var deadline: DispatchWorkItem?
    private var remaining = Set<ObjectIdentifier>()
    private var reading: CBCharacteristic?
    private var subscribed = false
    private var samples: [GattSample] = []

    func run(_ invoke: Invoke) {
        do {
            let request = try invoke.parseArgs(GattArgs.self)
            guard pending == nil else { invoke.reject("Another Bluetooth GATT operation is active"); return }
            guard BluetoothDiscovery.permissionState == "granted" else { invoke.reject("Bluetooth permission is required"); return }
            guard ["services", "read", "notify"].contains(request.operation),
                  UUID(uuidString: request.deviceId) != nil,
                  (1_000...30_000).contains(request.timeoutMs) else {
                invoke.reject("Invalid Bluetooth GATT operation, device ID or timeout"); return
            }
            if request.operation != "services" && (!validUuid(request.serviceUuid) || !validUuid(request.characteristicUuid)) {
                invoke.reject("Characteristic access requires valid service and characteristic UUIDs"); return
            }
            if request.operation == "notify" && (!(1_000...30_000).contains(request.durationMs ?? 5_000) || !(1...100).contains(request.sampleLimit ?? 100)) {
                invoke.reject("Notification duration must be 1000-30000 ms and sample limit 1-100"); return
            }
            pending = invoke
            args = request
            let timeout = DispatchWorkItem { [weak self] in self?.finish(error: "Bluetooth GATT operation timed out") }
            deadline = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(request.timeoutMs)), execute: timeout)
            central = CBCentralManager(delegate: self, queue: .main)
        } catch { invoke.reject(error.localizedDescription) }
    }

    private func validUuid(_ value: String?) -> Bool {
        guard let value else { return false }
        return value.range(of: "^(?:[0-9a-fA-F]{4}|[0-9a-fA-F]{8}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$", options: .regularExpression) != nil
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central === self.central, pending != nil, let args else { return }
        switch central.state {
        case .unknown, .resetting: return
        case .poweredOn:
            guard peripheral == nil, let id = UUID(uuidString: args.deviceId) else { return }
            guard let target = central.retrievePeripherals(withIdentifiers: [id]).first else {
                finish(error: "Device is unknown. Scan nearby Bluetooth devices first."); return
            }
            peripheral = target
            target.delegate = self
            central.connect(target)
        default: finish(error: "Bluetooth is unavailable, turned off or permission was denied")
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard central === self.central, peripheral === self.peripheral, let args else { return }
        peripheral.discoverServices(args.operation != "services" ? [CBUUID(string: args.serviceUuid!)] : nil)
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard central === self.central, peripheral === self.peripheral else { return }
        finish(error: error?.localizedDescription ?? "Bluetooth connection failed")
    }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard central === self.central, peripheral === self.peripheral else { return }
        finish(error: error?.localizedDescription ?? "Bluetooth device disconnected before completion")
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral === self.peripheral, let args else { return }
        if let error { finish(error: error.localizedDescription); return }
        let services = peripheral.services ?? []
        guard services.count <= 256 else { finish(error: "Too many Bluetooth services"); return }
        if services.isEmpty {
            if args.operation != "services" { finish(error: "Bluetooth service was not found") }
            else { finish() }
            return
        }
        remaining = Set(services.map { ObjectIdentifier($0) })
        for service in services {
            peripheral.discoverCharacteristics(args.operation != "services" ? [CBUUID(string: args.characteristicUuid!)] : nil, for: service)
        }
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard peripheral === self.peripheral, remaining.remove(ObjectIdentifier(service)) != nil, let args else { return }
        if let error { finish(error: error.localizedDescription); return }
        guard (peripheral.services ?? []).reduce(0, { $0 + ($1.characteristics?.count ?? 0) }) <= 1024 else {
            finish(error: "Too many Bluetooth characteristics"); return
        }
        guard remaining.isEmpty else { return }
        if args.operation == "services" { finish(); return }
        let matches = (peripheral.services ?? []).filter { $0.uuid == CBUUID(string: args.serviceUuid!) }
            .flatMap { $0.characteristics ?? [] }.filter { $0.uuid == CBUUID(string: args.characteristicUuid!) }
        guard matches.count == 1, let characteristic = matches.first else {
            finish(error: "Bluetooth characteristic is missing or ambiguous"); return
        }
        if args.operation == "notify" {
            guard characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) else {
                finish(error: "Characteristic does not support notifications or indications"); return
            }
            reading = characteristic
            peripheral.setNotifyValue(true, for: characteristic)
            return
        }
        guard characteristic.properties.contains(.read) else {
            finish(error: "This characteristic does not support reads; notification-only data requires a subscription"); return
        }
        reading = characteristic
        peripheral.readValue(for: characteristic)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === self.peripheral, characteristic === reading, args?.operation == "notify", !subscribed else { return }
        if let error { finish(error: error.localizedDescription); return }
        guard characteristic.isNotifying else { finish(error: "Bluetooth subscription was not enabled"); return }
        subscribed = true
        deadline?.cancel()
        let stop = DispatchWorkItem { [weak self] in self?.finish(stopReason: "duration") }
        deadline = stop
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(args?.durationMs ?? 5_000)), execute: stop)
        if samples.count >= (args?.sampleLimit ?? 100) { finish(stopReason: "sample_limit") }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === self.peripheral, characteristic === reading else { return }
        if let error { finish(error: error.localizedDescription); return }
        guard let data = characteristic.value, data.count <= 512 else {
            finish(error: "Bluetooth characteristic returned missing or oversized data"); return
        }
        let hex = data.map { String(format: "%02x", $0) }.joined()
        if args?.operation == "notify" {
            // A value may arrive before the subscription acknowledgement.
            if samples.count < (args?.sampleLimit ?? 100) {
                samples.append(GattSample(receivedAtMs: Int64(Date().timeIntervalSince1970 * 1000), dataHex: hex))
            }
            if subscribed && samples.count >= (args?.sampleLimit ?? 100) { finish(stopReason: "sample_limit") }
        } else { finish(dataHex: hex) }
    }

    private func finish(error: String? = nil, dataHex: String? = nil, stopReason: String? = nil) {
        guard let invoke = pending, let args else { return }
        let services = (peripheral?.services ?? []).map { service in
            GattService(uuid: service.uuid.uuidString, characteristics: (service.characteristics ?? []).map {
                GattCharacteristic(uuid: $0.uuid.uuidString, readable: $0.properties.contains(.read),
                    writable: $0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse),
                    notifiable: $0.properties.contains(.notify) || $0.properties.contains(.indicate))
            })
        }
        pending = nil
        self.args = nil
        deadline?.cancel()
        deadline = nil
        remaining.removeAll()
        let collected = samples
        samples.removeAll()
        if subscribed, let reading { peripheral?.setNotifyValue(false, for: reading) }
        subscribed = false
        reading = nil
        peripheral?.delegate = nil
        if let peripheral { central?.cancelPeripheralConnection(peripheral) }
        peripheral = nil
        central?.delegate = nil
        central = nil
        if let error { invoke.reject(error) }
        else { invoke.resolve(GattResult(deviceId: args.deviceId, services: services,
            serviceUuid: args.serviceUuid, characteristicUuid: args.characteristicUuid, dataHex: dataHex,
            samples: collected, stopReason: stopReason)) }
    }
}
