import Foundation

private final class ScopeRecorder {
    private let lock = NSLock()
    private var counts: [URL: Int] = [:]
    var failBookmark = false
    var failPersistence = false
    var denyAccess = false
    var stale = false
    let directory: URL
    let picked = URL(fileURLWithPath: "/file-provider/original-folder")

    init(directory: URL) { self.directory = directory }
    func count(_ url: URL) -> Int {
        lock.lock(); defer { lock.unlock() }; return counts[url] ?? 0
    }
    func start(_ url: URL) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if denyAccess { return false }
        counts[url, default: 0] += 1; return true
    }
    func stop(_ url: URL) {
        lock.lock(); defer { lock.unlock() }
        precondition((counts[url] ?? 0) > 0, "A grant must be released once on its original URL")
        counts[url, default: 0] -= 1
    }
    var operations: IOSWorkspaceFileOperations {
        IOSWorkspaceFileOperations(
            startAccess: { self.start($0) }, stopAccess: { self.stop($0) },
            canonicalize: { url in
                precondition(self.count(url) > 0, "Filesystem resolution requires an active grant")
                return self.directory
            },
            bookmark: { url in
                precondition(url == self.picked && self.count(url) > 0)
                if self.failBookmark { throw MobileExecutionError.io("Bookmark failure") }
                return Data("refreshed".utf8)
            },
            resolve: { _ in (self.picked, self.stale) },
            persist: { data, url in
                if self.failPersistence { throw MobileExecutionError.io("Persistence failure") }
                try IOSWorkspaceFileOperations.live.persist(data, url)
            }
        )
    }
}

@main
struct ExternalWorkspaceRegression {
    static func main() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        let root = temporary.resolvingSymlinksInPath().standardizedFileURL
        defer { try? FileManager.default.removeItem(at: root) }
        try mountLifecycle(in: root)
        try restoredBookmarks(in: root)
        try startupAccessWaitsForRestoration(in: root)
        try concurrentPersistence(in: root)
        print("External workspace grant identity, rollback, stale bookmark and persistence regressions passed")
    }

    private static func mountLifecycle(in root: URL) throws {
        let recorder = ScopeRecorder(directory: root)
        let file = root.appendingPathComponent("mounts.json")
        var store: IOSExternalWorkspaceStore? = IOSExternalWorkspaceStore(storeURL: file, operations: recorder.operations)
        let mounted = try store!.add(url: recorder.picked, allowWrite: true)
        let id = mounted["id"] as! String
        precondition(mounted["path"] as? String == root.path && mounted["writable"] as? Bool == true)
        precondition(recorder.count(recorder.picked) == 1)

        recorder.failPersistence = true
        do { _ = try store!.add(url: recorder.picked, allowWrite: false); preconditionFailure("Save must fail") }
        catch MobileExecutionError.io(_) { }
        precondition(store!.listEncodablePayload().first?.writable == true, "Failed replacement must preserve the old mount")
        precondition(recorder.count(recorder.picked) == 1, "Failed replacement releases its own grant, preserving the old one")
        do { _ = try store!.remove(id: id); preconditionFailure("Removal save must fail") }
        catch MobileExecutionError.io(_) { }
        precondition(store!.listEncodablePayload().first?.active == true && recorder.count(recorder.picked) == 1)

        recorder.failPersistence = false
        let replaced = try store!.add(url: recorder.picked, allowWrite: false)
        precondition(replaced["id"] as? String == id && replaced["writable"] as? Bool == false)
        precondition(recorder.count(recorder.picked) == 1, "Successful replacement releases the previous grant")
        let removed = try store!.remove(id: id)
        precondition(removed)
        precondition(recorder.count(recorder.picked) == 0 && store!.listEncodablePayload().isEmpty)

        recorder.failBookmark = true
        do { _ = try store!.add(url: recorder.picked, allowWrite: true); preconditionFailure("Bookmark must fail") }
        catch MobileExecutionError.io(_) { }
        precondition(recorder.count(recorder.picked) == 0)
        recorder.failBookmark = false; recorder.denyAccess = true
        do { _ = try store!.add(url: recorder.picked, allowWrite: true); preconditionFailure("Access must fail before filesystem work") }
        catch MobileExecutionError.invalidRequest(_) { }
        precondition(recorder.count(recorder.picked) == 0)
        recorder.denyAccess = false
        _ = try store!.add(url: recorder.picked, allowWrite: true)
        store = nil
        precondition(recorder.count(recorder.picked) == 0, "Store destruction releases its mount")
    }

    private static func seed(_ file: URL, path: String) throws {
        let entries: [[String: Any]] = [["id": "restored", "name": "Folder", "bookmark": Data("old".utf8).base64EncodedString(),
                                       "writable": false, "lastKnownPath": path]]
        try JSONSerialization.data(withJSONObject: entries).write(to: file)
    }

    private static func restoredBookmarks(in root: URL) throws {
        let recorder = ScopeRecorder(directory: root); recorder.stale = true
        let file = root.appendingPathComponent("restored.json")
        try seed(file, path: "/old-path")
        var store: IOSExternalWorkspaceStore? = IOSExternalWorkspaceStore(storeURL: file, operations: recorder.operations)
        precondition(store!.contains(path: root.path), "Restoration must complete and retain the original scope")
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [[String: Any]]
        precondition(saved.first?["bookmark"] as? String == Data("refreshed".utf8).base64EncodedString())
        precondition(saved.first?["lastKnownPath"] as? String == root.path)
        precondition(store!.listEncodablePayload().first?.writable == false, "Restoration preserves read-only intent")
        store = nil; precondition(recorder.count(recorder.picked) == 0)

        for failure in ["bookmark", "save"] {
            try seed(file, path: "/old-path")
            recorder.failBookmark = failure == "bookmark"; recorder.failPersistence = failure == "save"
            store = IOSExternalWorkspaceStore(storeURL: file, operations: recorder.operations)
            precondition(!store!.contains(path: root.path))
            precondition(recorder.count(recorder.picked) == 0, "A failing stale-bookmark restore must not leak scope")
            precondition(store!.listEncodablePayload().first?.detail?.contains("failure") == true)
            let persisted = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [[String: Any]]
            precondition(persisted.first?["bookmark"] as? String == Data("old".utf8).base64EncodedString())
            store = nil
        }
    }

    private static func startupAccessWaitsForRestoration(in root: URL) throws {
        let recorder = ScopeRecorder(directory: root)
        let file = root.appendingPathComponent("startup.json")
        try seed(file, path: root.path)
        let entered = DispatchSemaphore(value: 0), resume = DispatchSemaphore(value: 0)
        let complete = DispatchSemaphore(value: 0)
        var operations = recorder.operations
        operations.resolve = { _ in
            entered.signal(); precondition(resume.wait(timeout: .now() + 5) == .success)
            return (recorder.picked, false)
        }
        let store = IOSExternalWorkspaceStore(storeURL: file, operations: operations)
        precondition(entered.wait(timeout: .now() + 5) == .success)
        DispatchQueue.global().async {
            precondition(store.contains(path: root.path), "A startup command must wait for the retained grant")
            complete.signal()
        }
        precondition(complete.wait(timeout: .now() + .milliseconds(100)) == .timedOut)
        resume.signal(); precondition(complete.wait(timeout: .now() + 5) == .success)
        precondition(recorder.count(recorder.picked) == 1)
    }

    private static func concurrentPersistence(in root: URL) throws {
        let file = root.appendingPathComponent("concurrent.json")
        let first = root.appendingPathComponent("first", isDirectory: true)
        let second = root.appendingPathComponent("second", isDirectory: true)
        for directory in [first, second] { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        let writeEntered = DispatchSemaphore(value: 0), resumeWrite = DispatchSemaphore(value: 0)
        let finished = DispatchGroup()
        var operations = IOSWorkspaceFileOperations.live
        operations.startAccess = { _ in true }; operations.stopAccess = { _ in }
        operations.bookmark = { Data($0.path.utf8) }
        operations.persist = { data, url in
            let entries = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
            if entries.count == 1 { writeEntered.signal(); precondition(resumeWrite.wait(timeout: .now() + 5) == .success) }
            try IOSWorkspaceFileOperations.live.persist(data, url)
        }
        let store = IOSExternalWorkspaceStore(storeURL: file, operations: operations)
        finished.enter()
        DispatchQueue.global().async { defer { finished.leave() }; do { _ = try store.add(url: first, allowWrite: false) } catch { preconditionFailure("\(error)") } }
        precondition(writeEntered.wait(timeout: .now() + 5) == .success)
        finished.enter()
        DispatchQueue.global().async { defer { finished.leave() }; do { _ = try store.add(url: second, allowWrite: false) } catch { preconditionFailure("\(error)") } }
        resumeWrite.signal(); precondition(finished.wait(timeout: .now() + 5) == .success)
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [[String: Any]]
        precondition(saved.count == 2 && store.listEncodablePayload().count == 2, "Concurrent writes must preserve every committed mount")
    }
}
