import SwiftUI

@MainActor final class XgentNumberInputState: ObservableObject {
    @Published var draft = XgentNumberInputDraft()
    weak var composition: XgentNumberComposition?
}

@MainActor final class XgentNumberDraftStore {
    private struct Key: Hashable { let surface: String; let node: String }
    private struct Entry {
        weak var state: XgentNumberInputState?
        let action: String?
        let lease: UUID
    }
    private var entries: [Key: Entry] = [:]

    func attach(surface: String, node: XgentNode, state: XgentNumberInputState) -> UUID {
        let lease = UUID()
        entries[.init(surface: surface, node: node.id)] = .init(state: state, action: node.action, lease: lease)
        return lease
    }
    func detach(surface: String, node: String, lease: UUID?) {
        let key = Key(surface: surface, node: node)
        if entries[key]?.lease == lease { entries.removeValue(forKey: key) }
    }
    func clear(surface: String? = nil) {
        if let surface { entries = entries.filter { $0.key.surface != surface } }
        else { entries.removeAll() }
    }
    func commit(_ node: XgentNode, surface: String) -> XgentValue? {
        guard let entry = entries[.init(surface: surface, node: node.id)], entry.action == node.action,
              let state = entry.state, state.draft.pending != nil || state.composition?.marked == true else { return nil }
        if state.composition?.marked == true, let text = state.composition?.committedText() { state.draft.pending = text }
        guard node.disabled != true,
              let limits = XgentNumberInputConstraints(minimum: node.minimum, maximum: node.maximum, step: node.step,
                                                     allowsUnboundedMaximum: node.clearable == true) else {
            state.draft.pending = nil; return nil
        }
        switch state.draft.commit(blur: true, limits: limits, integerOnly: node.integerOnly == true, clearable: node.clearable == true) {
        case .number(let value, _): return .number(value)
        case .clear: return .null
        case .revert: return nil
        }
    }
}
