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
    let access: IOSWorkspaceAccessLease
}

struct ExternalWorkspaceListItem: Encodable {
    let id: String
    let name: String
    let path: String
    let writable: Bool
    let active: Bool
    let detail: String?
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
    private let storeURL: URL
    private let operations: IOSWorkspaceFileOperations
    private var entries: [PersistedExternalWorkspace]
    private var activeById: [String: ActiveExternalWorkspace] = [:]
    private var restoreErrors: [String: String] = [:]

    init(storeURL: URL? = nil, operations: IOSWorkspaceFileOperations = .live) {
        self.storeURL = storeURL ?? Self.defaultStoreURL
        self.operations = operations
        entries = Self.loadPersisted(at: self.storeURL)
        restorePersistedWorkspaces(entries)
    }

    func listEncodablePayload() -> [ExternalWorkspaceListItem] {
        lock.lock()
        defer { lock.unlock() }
        return entries.map { entry in
            encodablePayload(
                entry,
                active: activeById[entry.id],
                restoreError: restoreErrors[entry.id]
            )
        }
    }

    func add(url pickedURL: URL, allowWrite: Bool) throws -> [String: Any] {
        let access = try IOSWorkspaceAccessLease(url: pickedURL, operations: operations)
        let url = operations.canonicalize(pickedURL)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw MobileExecutionError.invalidRequest("The selected workspace is unavailable")
        }

        do {
            let bookmark = try operations.bookmark(pickedURL)
            let canonicalPath = url.path
            let writable = allowWrite && Self.probeWritable(at: url)

            // Serializing the complete mutation keeps an older snapshot/rollback
            // from overwriting a concurrent add, remove or bookmark restoration.
            persistenceLock.lock()
            defer { persistenceLock.unlock() }

            lock.lock()
            if let existingIndex = entries.firstIndex(where: { entry in
                activeById[entry.id]?.url.path == canonicalPath
                    || entry.lastKnownPath == canonicalPath
            }) {
                let previousEntry = entries[existingIndex]
                let previousActive = activeById[previousEntry.id]
                let previousError = restoreErrors[previousEntry.id]
                let refreshed = PersistedExternalWorkspace(
                    id: previousEntry.id,
                    name: previousEntry.name,
                    bookmark: bookmark,
                    writable: writable,
                    lastKnownPath: canonicalPath
                )
                entries[existingIndex] = refreshed
                let replacement = ActiveExternalWorkspace(persisted: refreshed, url: url, access: access)
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
                        restoreErrors[previousEntry.id] = previousError
                    }
                    lock.unlock()
                    throw error
                }
                return payload(refreshed, active: replacement, restoreError: nil)
            }

            let persisted = PersistedExternalWorkspace(
                id: UUID().uuidString.lowercased(),
                name: String(url.lastPathComponent.prefix(80)),
                bookmark: bookmark,
                writable: writable,
                lastKnownPath: canonicalPath
            )
            let active = ActiveExternalWorkspace(persisted: persisted, url: url, access: access)
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
            throw error
        }
    }

    func remove(id: String) throws -> Bool {
        persistenceLock.lock()
        defer { persistenceLock.unlock() }
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
        activeById.removeValue(forKey: id)
        restoreErrors.removeValue(forKey: id)
        lock.unlock()
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
        let group = restoreGroup
        for entry in snapshot {
            group.enter()
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                defer { group.leave() }
                self?.restore(entry)
            }
        }
    }

    private func restore(_ entry: PersistedExternalWorkspace) {
        do {
            let resolved = try operations.resolve(entry.bookmark)
            let access = try IOSWorkspaceAccessLease(url: resolved.url, operations: operations)
            let url = operations.canonicalize(resolved.url)
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
                  isDirectory.boolValue else {
                recordRestoreError(id: entry.id, message: "The folder is currently unavailable")
                return
            }

            var refreshed = entry
            refreshed.lastKnownPath = url.path
            if resolved.stale {
                refreshed.bookmark = try operations.bookmark(resolved.url)
            }

            persistenceLock.lock()
            defer { persistenceLock.unlock() }
            lock.lock()
            guard let index = entries.firstIndex(where: { $0.id == entry.id }),
                  entries[index].bookmark == entry.bookmark,
                  activeById[entry.id] == nil else {
                lock.unlock()
                return
            }
            entries[index] = refreshed
            activeById[entry.id] = ActiveExternalWorkspace(persisted: refreshed, url: url, access: access)
            restoreErrors.removeValue(forKey: entry.id)
            let snapshot = entries
            lock.unlock()
            if refreshed.bookmark != entry.bookmark || refreshed.lastKnownPath != entry.lastKnownPath {
                do { try save(snapshot) }
                catch {
                    lock.lock()
                    entries[index] = entry
                    activeById.removeValue(forKey: entry.id)
                    lock.unlock()
                    throw error
                }
            }
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

    private func encodablePayload(
        _ entry: PersistedExternalWorkspace,
        active: ActiveExternalWorkspace?,
        restoreError: String?
    ) -> ExternalWorkspaceListItem {
        let detail: String?
        if let restoreError {
            detail = restoreError
        } else if active == nil {
            detail = "Restoring access to the selected folder"
        } else if !entry.writable {
            detail = "The selected folder is mounted read-only"
        } else {
            detail = nil
        }
        return ExternalWorkspaceListItem(
            id: entry.id,
            name: entry.name,
            path: active?.url.path ?? entry.lastKnownPath ?? "",
            writable: entry.writable,
            active: active != nil,
            detail: detail
        )
    }

    private func save(_ persisted: [PersistedExternalWorkspace]) throws {
        // The caller holds persistenceLock across its state update and rollback.
        let data = try JSONEncoder().encode(persisted)
        try operations.persist(data, storeURL)
    }

    private static func loadPersisted(at storeURL: URL) -> [PersistedExternalWorkspace] {
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
        let probe = url.appendingPathComponent(".xgent-write-\(UUID().uuidString)")
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

    private static var defaultStoreURL: URL {
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
