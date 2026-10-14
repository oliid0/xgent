import Foundation
import Network
import Tauri

/// Foreground-only service presence, never credentials or task authority.
final class WorkstationDiscovery {
    private static let queue = DispatchQueue(label: "xgent.workstation.discovery")
    private static var active: WorkstationDiscovery?
    private let invoke: Invoke
    private let browser = NWBrowser(for: .bonjourWithTXTRecord(type: "_xgent._tcp", domain: "local."), using: .tcp)
    private var connections: [String: NWConnection] = [:]
    private var services: [String: [String: Any]] = [:]
    private var finished = false

    private init(_ invoke: Invoke) { self.invoke = invoke }
    static func discover(_ invoke: Invoke) {
        queue.async {
            guard active == nil else { invoke.reject("LAN discovery is busy"); return }
            let session = WorkstationDiscovery(invoke)
            active = session
            session.start()
        }
    }
    private func start() {
        browser.stateUpdateHandler = { [weak self] state in
            if case .failed(let error) = state { self?.finish(error.localizedDescription) }
            if case .waiting(let error) = state { self?.finish(error.localizedDescription) }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in self?.update(results) }
        browser.start(queue: Self.queue)
        Self.queue.asyncAfter(deadline: .now() + 4) { [weak self] in self?.finish(nil) }
    }
    private func update(_ results: Set<NWBrowser.Result>) {
        guard !finished else { return }
        var present = Set<String>()
        for result in results.prefix(64) {
            guard case .bonjour(let record) = result.metadata,
                  case .string(let version)? = record.getEntry(for: "v"), version == "1",
                  case .string(let id)? = record.getEntry(for: "id"), UUID(uuidString: id)?.uuidString.lowercased() == id,
                  case .string(let platform)? = record.getEntry(for: "p"), ["macos", "windows", "linux"].contains(platform) else { continue }
            present.insert(id)
            guard connections[id] == nil else { continue }
            // Resolve an actually reachable endpoint; send no HTTP or cookie.
            let connection = NWConnection(to: result.endpoint, using: .tcp)
            connections[id] = connection
            connection.stateUpdateHandler = { [weak self, weak connection] state in
                guard let self, let connection, !self.finished, self.connections[id] === connection else { return }
                if case .ready = state,
                   case .hostPort(let host, let port)? = connection.currentPath?.remoteEndpoint,
                   case .ipv4(let ip) = host, port.rawValue > 0 {
                    let parts = ip.debugDescription.split(separator: ".").compactMap { Int($0) }
                    guard parts.count == 4, parts[0] == 10 || (parts[0] == 172 && (16...31).contains(parts[1])) || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 169 && parts[1] == 254) else { connection.cancel(); return }
                    self.services[id] = ["hostId": id, "platform": platform, "urls": ["http://\(ip.debugDescription):\(port.rawValue)"]]
                    connection.cancel()
                }
            }
            connection.start(queue: Self.queue)
        }
        for id in Array(connections.keys) where !present.contains(id) {
            connections.removeValue(forKey: id)?.cancel()
            services.removeValue(forKey: id)
        }
    }
    private func finish(_ error: String?) {
        guard !finished else { return }
        finished = true
        browser.cancel()
        connections.values.forEach { $0.cancel() }
        connections.removeAll()
        Self.active = nil
        if let error { invoke.reject(error) }
        else { invoke.resolve(["services": services.keys.sorted().compactMap { services[$0] }]) }
    }
}
