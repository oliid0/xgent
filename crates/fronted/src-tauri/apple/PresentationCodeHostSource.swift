import SwiftUI
import Combine

@MainActor
final class XgentCodeHostSource: ObservableObject {
    let objectWillChange = ObservableObjectPublisher()
    private(set) var content: String {
        didSet { if content != oldValue { publishContentChange() } }
    }
    private var notificationQueued = false
    private var lease: UUID?
    private var editable = false
    private var active = true
    private var changed: ((String) -> Void)?
    private var readInput: (() -> String?)?
    private var commitInput: (() -> Bool)?
    private var resetInputUndo: (() -> Void)?
    var inputContent: String? { readInput?() }
    init(_ content: String) { self.content = content }

    private func publishContentChange() {
        guard !notificationQueued else { return }
        notificationQueued = true
        // Source actions must read the latest text immediately, but observing
        // hosting roots must update outside a representable render transaction.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.notificationQueued = false
            guard self.active else { return }
            self.objectWillChange.send()
        }
    }

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
    func retire() {
        resetInputUndo?()
        active = false; lease = nil; changed = nil; editable = false
        readInput = nil; commitInput = nil; resetInputUndo = nil
    }
    func clearInputUndo() { resetInputUndo?() }
    func attachInput(read: @escaping () -> String?, commit: @escaping () -> Bool, resetUndo: (() -> Void)? = nil) {
        guard active else { return }
        readInput = read; commitInput = commit; resetInputUndo = resetUndo
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
