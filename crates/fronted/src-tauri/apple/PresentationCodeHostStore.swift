import Foundation

@MainActor
final class XgentCodeHostStore {
    private struct Scope { let surface: String?; let sessions: XgentCodeHostSessions }
    private var scopes: [String: Scope] = [:]
    private var entries: [String: XgentCodeHost] = [:]
    private var active = true
    func nativeEvidence() -> [[String: String]] {
        entries.keys.sorted().compactMap { entries[$0]?.evidence }
    }

    func acquire(_ session: XgentCodeSessionIdentity, content: String) -> XgentCodeHost? {
        guard active, session.open.contains(session.key),
              scopes[session.scope].map({ $0.surface != nil && $0.sessions.open.contains(session.key) }) ?? true else { return nil }
        prune(scope: session.scope, open: scopes[session.scope]?.sessions.open ?? session.open)
        if let entry = entries[session.cacheKey] { return entry }
        let entry = XgentCodeHost(session: session, content: content)
        entries[session.cacheKey] = entry; return entry
    }
    @discardableResult
    func reconcile(_ sessions: XgentCodeHostSessions, surface: String) -> Bool {
        guard active, sessions.revision > (scopes[sessions.scope]?.sessions.revision ?? 0) else { return false }
        for (scope, value) in scopes where value.surface == surface && scope != sessions.scope {
            prune(scope: scope, open: [])
            scopes[scope] = Scope(surface: nil, sessions: value.sessions)
        }
        scopes[sessions.scope] = Scope(surface: surface, sessions: sessions)
        prune(scope: sessions.scope, open: sessions.open)
        return true
    }
    func scopes(on surface: String) -> [String] { scopes.filter { $0.value.surface == surface }.map(\.key) }
    func commit(in document: XgentDocument) {
        guard active, let field = document.node(id: "workspace-file-editor"),
              let session = XgentCodeSessionIdentity.decode(field.text) else { return }
        entries[session.cacheKey]?.source.commitCurrent()
    }
    func remove(surface: String) -> [String] {
        let removed = scopes.filter { $0.value.surface == surface }.map(\.key)
        for scope in removed {
            if let value = scopes[scope] { scopes[scope] = Scope(surface: nil, sessions: value.sessions) }
            prune(scope: scope, open: [])
        }
        return removed
    }
    private func prune(scope: String, open: [String]) {
        let valid = Set(open.map { "\(scope.utf8.count):\(scope)\($0)" })
        for (key, entry) in entries where entry.identity.scope == scope && !valid.contains(key) {
            entry.retire(); entries.removeValue(forKey: key)
        }
    }
    func clear() {
        active = false
        for entry in entries.values { entry.retire() }
        entries.removeAll(); scopes.removeAll()
    }
}
