import CodeEditorView
import Foundation

@MainActor
final class XgentCodeSessionStore {
    private struct Entry {
        let scope: String
        var position = CodeEditor.Position()
        var horizontal: CGFloat = 0
        var revealed: String?
        var findEdit = 0
        var findReveal = 0
        var owner: UUID?
        var restoring = false
    }
    private var entries: [String: Entry] = [:]
    private var liveSessions: [String: Set<String>] = [:]
    private var active = true

    func prepare(_ session: XgentCodeSessionIdentity, owner: UUID, restoring: Bool = false) {
        guard active, session.open.contains(session.key),
              liveSessions[session.scope]?.contains(session.key) ?? true else { return }
        let valid = Set(session.open.map { "\(session.scope.utf8.count):\(session.scope)\($0)" })
        entries = entries.filter { $0.value.scope != session.scope || valid.contains($0.key) }
        var entry = entries[session.cacheKey] ?? Entry(scope: session.scope)
        if entry.owner != owner { entry.restoring = restoring }
        entry.owner = owner; entries[session.cacheKey] = entry
    }
    func position(_ session: XgentCodeSessionIdentity, text: String) -> CodeEditor.Position {
        XgentCodeSessionPosition.clamp(entries[session.cacheKey]?.position ?? CodeEditor.Position(), in: text)
    }
    func horizontal(_ session: XgentCodeSessionIdentity) -> CGFloat { entries[session.cacheKey]?.horizontal ?? 0 }
    func owns(_ session: XgentCodeSessionIdentity, owner: UUID) -> Bool { entries[session.cacheKey]?.owner == owner }
    func save(_ position: CodeEditor.Position, session: XgentCodeSessionIdentity, owner: UUID, text: String, horizontal: CGFloat? = nil) {
        guard owns(session, owner: owner), entries[session.cacheKey]?.restoring != true else { return }
        entries[session.cacheKey]?.position = XgentCodeSessionPosition.clamp(position, in: text)
        if let horizontal { entries[session.cacheKey]?.horizontal = horizontal.isFinite ? max(0, horizontal) : 0 }
    }
    func finishRestoring(_ session: XgentCodeSessionIdentity, owner: UUID) {
        guard owns(session, owner: owner) else { return }
        entries[session.cacheKey]?.restoring = false
    }
    func revealed(_ request: String, session: XgentCodeSessionIdentity) -> Bool { entries[session.cacheKey]?.revealed == request }
    func markRevealed(_ request: String, session: XgentCodeSessionIdentity, owner: UUID) {
        guard owns(session, owner: owner) else { return }
        entries[session.cacheKey]?.revealed = request
    }
    func release(_ session: XgentCodeSessionIdentity, owner: UUID) {
        guard owns(session, owner: owner) else { return }
        entries[session.cacheKey]?.owner = nil
    }
    func consumeFind(_ request: Int, editing: Bool, session: XgentCodeSessionIdentity, owner: UUID) -> Bool {
        guard owns(session, owner: owner), request > 0,
              let entry = entries[session.cacheKey], request > (editing ? entry.findEdit : entry.findReveal) else { return false }
        if editing { entries[session.cacheKey]?.findEdit = request }
        else { entries[session.cacheKey]?.findReveal = request }
        return true
    }
    func clear() { active = false; entries.removeAll(); liveSessions.removeAll() }
    func reconcile(scope: String, open: [String]) {
        guard active else { return }
        liveSessions[scope] = Set(open)
        let valid = Set(open.map { "\(scope.utf8.count):\(scope)\($0)" })
        entries = entries.filter { $0.value.scope != scope || valid.contains($0.key) }
    }
}
