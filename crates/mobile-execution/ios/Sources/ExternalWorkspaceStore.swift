import Foundation

private struct PersistedExternalWorkspace: Codable, Sendable {
    let id: String
    let name: String
    var bookmark: Data
    let writable: Bool
    var lastKnownPath: String?
}

private struct ActiveExternalWorkspace {
    var persisted: PersistedExternalWorkspace
    let url: URL
}

/**
 * Owns persistent security-scoped folder grants used by the iOS a-Shell
 * backend and by Rust file tools in the same application process.
 *
 * Bookmark resolution is deliberately kept off the main thread. Resolving a
 * bookmark owned by a FileProvider may perform a synchronous XPC call and a
 * slow provider must never block application launch.
 */
final class IOSExternalWorkspaceStore {
    private let lock = NSLock()
    private let persistenceLock = NSLock()
    private let restoreGroup = DispatchGroup()
    private var entries: [PersistedExternalWorkspace]
    private var activeById: [String: ActiveExternalWorkspace] = [:]
    private var restoreErrors: [String: String] = [:]

    init() {
        entries = Self.loadPersisted()
        restorePersistedWorkspaces(entries)
    }

    deinit {
        lock.lock()
        let urls = activeById.values.map(\.url)
        activeById.removeAll()
        lock.unlock()
        urls.forEach { $0.stopAccessingSecurityScopedResource() }
    }

    func listPayload() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return entries.map { entry in
            payload(
                entry,
                active: activeById[entry.id],
                restoreError: restoreErrors[entry.id]
            )
        }
    }

    func add(url pickedURL: URL, allowWrite: Bool) throws -> [String: Any] {
        let url = pickedURL.resolvingSymlinksInPath().standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw MobileExecutionError.invalidRequest("The selected workspace is unavailable")
        }

        guard url.startAccessingSecurityScopedResource() else {
            throw MobileExecutionError.invalidRequest(
                "Could not retain access to the selected workspace"
            )
        }

        do {
            let bookmark = try url.bookmarkData(
                options: [],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            let canonicalPath = url.path
            let writable = allowWrite && Self.probeWritable(at: url)

            lock.lock()
            if let existingIndex = entries.firstIndex(where: { entry in
                activeById[entry.id]?.url.path == canonicalPath
                    || entry.lastKnownPath == canonicalPath
            }) {
                let previousEntry = entries[existingIndex]
                let previousActive = activeById[previousEntry.id]
                let refreshed = PersistedExternalWorkspace(
                    id: previousEntry.id,
                    name: previousEntry.name,
                    bookmark: bookmark,
                    writable: writable,
                    lastKnownPath: canonicalPath
                )
                entries[existingIndex] = refreshed
                let replacement = ActiveExternalWorkspace(persisted: refreshed, url: url)
                activeById[refreshed.id] = replacement
                restoreErrors.removeValue(forKey: refreshed.id)
                let snapshot = entries
                lock.unlock()

                do {
                    try save(snapshot)
                } catch {
                    lock.lock()
                    if let rollbackIndex = entries.firstIndex(where: {
                        $0.id == previousEntry.id
                    }) {
                        entries[rollbackIndex] = previousEntry
                        if let previousActive {
                            activeById[previousEntry.id] = previousActive
                        } else {
                            activeById.removeValue(forKey: previousEntry.id)
                        }
                    }
                    lock.unlock()
                    throw error
                }
                previousActive?.url.stopAccessingSecurityScopedResource()
                return payload(refreshed, active: replacement, restoreError: nil)
            }

            let persisted = PersistedExternalWorkspace(
                id: UUID().uuidString.lowercased(),
                name: String(url.lastPathComponent.prefix(80)),
                bookmark: bookmark,
                writable: writable,
                lastKnownPath: canonicalPath
            )
            let active = ActiveExternalWorkspace(persisted: persisted, url: url)
            guard entries.count < Self.maximumWorkspaces else {
                lock.unlock()
                throw MobileExecutionError.invalidRequest(
                    "Remove an existing workspace before mounting another one"
                )
            }
            entries.append(persisted)
            activeById[persisted.id] = active
            let snapshot = entries
            lock.unlock()

            do {
                try save(snapshot)
            } catch {
                lock.lock()
                entries.removeAll { $0.id == persisted.id }
                activeById.removeValue(forKey: persisted.id)
                lock.unlock()
                throw error
            }
            return payload(persisted, active: active, restoreError: nil)
        } catch {
            url.stopAccessingSecurityScopedResource()
            throw error
        }
    }

    func remove(id: String) throws -> Bool {
        lock.lock()
        guard entries.contains(where: { $0.id == id }) else {
            lock.unlock()
            return false
        }
        let previousEntries = entries
        entries.removeAll { $0.id == id }
        let snapshot = entries
        lock.unlock()

        do {
            try save(snapshot)
        } catch {
            lock.lock()
            entries = previousEntries
            lock.unlock()
            throw error
        }

        lock.lock()
        let removedActive = activeById.removeValue(forKey: id)
        restoreErrors.removeValue(forKey: id)
        lock.unlock()
        removedActive?.url.stopAccessingSecurityScopedResource()
        return true
    }

    func contains(path: String) -> Bool {
        // A shell command may arrive immediately after application launch,
        // before asynchronous FileProvider bookmark restoration finishes.
        // Wait briefly off the main thread so a valid persisted workspace is
        // not rejected merely because restoration lost the startup race.
        _ = restoreGroup.wait(timeout: .now() + 2)
        let candidate = URL(fileURLWithPath: path)
            .resolvingSymlinksInPath()
            .standardizedFileURL.path
        lock.lock()
        defer { lock.unlock() }
        return activeById.values.contains { active in
            candidate == active.url.path || candidate.hasPrefix(active.url.path + "/")
        }
    }

    private func restorePersistedWorkspaces(_ snapshot: [PersistedExternalWorkspace]) {
        for entry in snapshot {
            restoreGroup.enter()
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                defer { self?.restoreGroup.leave() }
                self?.restore(entry)
            }
        }
    }

    private func restore(_ entry: PersistedExternalWorkspace) {
        do {
            var stale = false
            let url = try URL(
                resolvingBookmarkData: entry.bookmark,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            ).resolvingSymlinksInPath().standardizedFileURL
            guard url.startAccessingSecurityScopedResource() else {
                recordRestoreError(
                    id: entry.id,
                    message: "Permission must be granted again for this folder"
                )
                return
            }
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
                  isDirectory.boolValue else {
                url.stopAccessingSecurityScopedResource()
                recordRestoreError(id: entry.id, message: "The folder is currently unavailable")
                return
            }

            var refreshed = entry
            refreshed.lastKnownPath = url.path
            if stale {
                refreshed.bookmark = try url.bookmarkData(
                    options: [],
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                )
            }

            lock.lock()
            guard let index = entries.firstIndex(where: { $0.id == entry.id }),
                  activeById[entry.id] == nil else {
                lock.unlock()
                url.stopAccessingSecurityScopedResource()
                return
            }
            entries[index] = refreshed
            activeById[entry.id] = ActiveExternalWorkspace(persisted: refreshed, url: url)
            restoreErrors.removeValue(forKey: entry.id)
            lock.unlock()
        } catch {
            recordRestoreError(id: entry.id, message: error.localizedDescription)
        }
    }

    private func recordRestoreError(id: String, message: String) {
        lock.lock()
        if entries.contains(where: { $0.id == id }) && activeById[id] == nil {
            restoreErrors[id] = message
        }
        lock.unlock()
    }

    private func payload(
        _ entry: PersistedExternalWorkspace,
        active: ActiveExternalWorkspace?,
        restoreError: String?
    ) -> [String: Any] {
        let detail: Any
        if let restoreError {
            detail = restoreError
        } else if active == nil {
            detail = "Restoring access to the selected folder"
        } else if !entry.writable {
            detail = "The selected folder is mounted read-only"
        } else {
            detail = NSNull()
        }
        return [
            "id": entry.id,
            "name": entry.name,
            "path": active?.url.path ?? entry.lastKnownPath ?? "",
            "writable": entry.writable,
            "active": active != nil,
            "detail": detail,
        ]
    }

    private func save(_ persisted: [PersistedExternalWorkspace]) throws {
        persistenceLock.lock()
        defer { persistenceLock.unlock() }
        let manager = FileManager.default
        try manager.createDirectory(
            at: Self.storeURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try JSONEncoder().encode(persisted)
        try data.write(to: Self.storeURL, options: .atomic)
    }

    private static func loadPersisted() -> [PersistedExternalWorkspace] {
        guard let data = try? Data(contentsOf: storeURL),
              let decoded = try? JSONDecoder().decode(
                [PersistedExternalWorkspace].self,
                from: data
              ) else {
            return []
        }
        var seen = Set<String>()
        return Array(
            decoded.filter { entry in
                !entry.id.isEmpty && seen.insert(entry.id).inserted
            }.suffix(maximumWorkspaces)
        )
    }

    private static func probeWritable(at url: URL) -> Bool {
        let probe = url.appendingPathComponent(".xagent-write-\(UUID().uuidString)")
        do {
            try Data([0]).write(to: probe, options: .atomic)
            try? FileManager.default.removeItem(at: probe)
            return true
        } catch {
            try? FileManager.default.removeItem(at: probe)
            return false
        }
    }

    private static let maximumWorkspaces = 12

    private static var storeURL: URL {
        let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        return support
            .appendingPathComponent("xgent", isDirectory: true)
            .appendingPathComponent("mobile-execution", isDirectory: true)
            .appendingPathComponent("external-workspaces.json")
    }
}
