#if os(macOS)
import AppKit
import Foundation

struct XgentFileApplicationOpenReply: Codable, Sendable {
    let ok: Bool
    let error: String?
}

private final class XgentFileApplicationCompletion: @unchecked Sendable {
    let semaphore = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var result = XgentFileApplicationOpenReply(ok: false, error: "Application launch did not complete")

    func finish(_ result: XgentFileApplicationOpenReply) {
        lock.lock(); self.result = result; lock.unlock()
        semaphore.signal()
    }

    func completed() -> XgentFileApplicationOpenReply {
        lock.lock(); defer { lock.unlock() }
        return result
    }
}

enum XgentWorkspaceFileApplicationOpen {
    // Rust calls this from its blocking filesystem worker, after workspace scope validation.
    static func open(_ path: String, applicationID: String) -> XgentFileApplicationOpenReply {
        guard !Thread.isMainThread else {
            return .init(ok: false, error: "Application opening must run from the filesystem worker")
        }
        let reply = XgentWorkspaceFileApplications.query(path)
        if let error = reply.error { return .init(ok: false, error: error) }
        guard reply.applications.contains(where: { $0.id == applicationID }),
              applicationID.hasPrefix("macos:"),
              let applicationURL = URL(string: String(applicationID.dropFirst("macos:".count))),
              applicationURL.isFileURL else {
            return .init(ok: false, error: "The selected application is no longer registered for this file")
        }
        let completion = XgentFileApplicationCompletion()
        DispatchQueue.main.async {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            NSWorkspace.shared.open([URL(fileURLWithPath: path)], withApplicationAt: applicationURL,
                                    configuration: configuration) { application, error in
                if let error { completion.finish(.init(ok: false, error: error.localizedDescription)) }
                else if application != nil { completion.finish(.init(ok: true, error: nil)) }
                else { completion.finish(.init(ok: false, error: "The system did not return an opened application")) }
            }
        }
        guard completion.semaphore.wait(timeout: .now() + 30) == .success else {
            return .init(ok: false, error: "Application launch was requested but completion timed out; do not automatically repeat this action")
        }
        return completion.completed()
    }
}
#endif
