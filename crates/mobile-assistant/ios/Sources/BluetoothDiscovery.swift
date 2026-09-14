import CoreBluetooth
import Foundation
import Tauri

private struct BluetoothScanArgs: Decodable { let timeoutMs: UInt64 }
private struct BluetoothDevicePayload: Encodable {
    let id: String
    let name: String?
    let rssi: Int
    let serviceUuids: [String]
}

// Create the central only after a user action; reading settings never prompts.
final class BluetoothDiscovery: NSObject, CBCentralManagerDelegate {
    private var central: CBCentralManager?
    private var permissionReplies: [() -> Void] = []
    private var scanInvoke: Invoke?
    private var timeout: DispatchWorkItem?
    private var devices: [String: BluetoothDevicePayload] = [:]

    static var permissionState: String {
        switch CBManager.authorization {
        case .allowedAlways: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "denied"
        }
    }

    func requestPermission(_ reply: @escaping () -> Void) {
        if Self.permissionState != "prompt" { reply(); return }
        permissionReplies.append(reply)
        activate()
    }

    private func activate() {
        if central == nil { central = CBCentralManager(delegate: self, queue: .main) }
    }

    func scan(_ invoke: Invoke) {
        do {
            let args = try invoke.parseArgs(BluetoothScanArgs.self)
            guard (1_000...30_000).contains(args.timeoutMs) else {
                invoke.reject("Bluetooth scan duration must be between 1000 and 30000 ms")
                return
            }
            guard Self.permissionState == "granted" else {
                invoke.reject("Bluetooth permission is required")
                return
            }
            guard scanInvoke == nil else {
                invoke.reject("Another Bluetooth scan is active")
                return
            }
            scanInvoke = invoke
            devices.removeAll()
            activate()
            let deadline = DispatchWorkItem { [weak self] in self?.finish() }
            timeout = deadline
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(args.timeoutMs)), execute: deadline)
            startIfReady()
        } catch { invoke.reject(error.localizedDescription) }
    }

    private func startIfReady() {
        guard scanInvoke != nil, let central else { return }
        switch central.state {
        case .poweredOn:
            if !central.isScanning { central.scanForPeripherals(withServices: nil) }
        case .unknown, .resetting: break
        case .poweredOff: finish(error: "Bluetooth is turned off. Enable it in system settings.")
        case .unauthorized: finish(error: "Bluetooth permission was denied")
        case .unsupported: finish(error: "Bluetooth LE is unavailable on this device")
        @unknown default: finish(error: "Bluetooth is unavailable")
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if Self.permissionState != "prompt" {
            let replies = permissionReplies
            permissionReplies.removeAll()
            replies.forEach { $0() }
        }
        startIfReady()
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard scanInvoke != nil else { return }
        let id = peripheral.identifier.uuidString
        guard devices[id] != nil || devices.count < 200 else { return }
        let services = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        devices[id] = BluetoothDevicePayload(
            id: id, name: advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name,
            rssi: RSSI.intValue, serviceUuids: services.map(\.uuidString))
    }

    private func finish(error: String? = nil) {
        guard let invoke = scanInvoke else { return }
        scanInvoke = nil
        timeout?.cancel()
        timeout = nil
        let ready = central?.state == .poweredOn
        central?.stopScan()
        if let error { invoke.reject(error) }
        else if !ready { invoke.reject("Bluetooth did not become ready before the scan deadline") }
        else { invoke.resolve(devices.values.sorted { $0.id < $1.id }) }
        devices.removeAll()
    }
}
