import SwiftUI

@MainActor
final class XgentCodeHostSource: ObservableObject {
    @Published private(set) var content: String
    private var lease: UUID?
    private var editable = false
    private var active = true
    private var changed: ((String) -> Void)?
    private var readInput: (() -> String?)?
    private var commitInput: (() -> Bool)?
    var inputContent: String? { readInput?() }
    init(_ content: String) { self.content = content }

    @discardableResult
    func activate(_ lease: UUID, content: String, editable: Bool, changed: @escaping (String) -> Void) -> Bool {
        guard active else { return false }
        self.lease = lease; self.editable = editable; self.changed = changed
        let replaced = self.content != content
        if replaced { self.content = content }
        return replaced
    }
    func owns(_ lease: UUID) -> Bool { active && self.lease == lease }
    func detach(_ lease: UUID) {
        guard owns(lease) else { return }
        self.lease = nil; changed = nil; editable = false
    }
    func retire() { active = false; lease = nil; changed = nil; editable = false; readInput = nil; commitInput = nil }
    func attachInput(read: @escaping () -> String?, commit: @escaping () -> Bool) {
        guard active else { return }
        readInput = read; commitInput = commit
    }
    func commitCurrent() {
        guard active, editable, let lease, commitInput?() == true, let value = readInput?() else { return }
        binding(lease).wrappedValue = value
    }
    func binding(_ lease: UUID) -> Binding<String> {
        Binding(get: { [weak self] in self?.content ?? "" }, set: { [weak self] value in
            guard let self, self.owns(lease), self.editable, value != self.content else { return }
            if let actual = self.readInput?(), actual != value { return }
            self.content = value; self.changed?(value)
        })
    }
}
