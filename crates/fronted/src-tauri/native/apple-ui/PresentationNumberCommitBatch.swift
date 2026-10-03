import Foundation

@MainActor final class XgentNumberCommitBatch {
    let surface: String
    let node: String
    let kind: XgentNodeKind
    let action: XgentAction
    private var outstanding: Set<String>
    private var completion: ((Bool) -> Void)?
    var timeout: Task<Void, Never>?

    init(surface: String, node: String, kind: XgentNodeKind, action: XgentAction, requests: [String], completion: @escaping (Bool) -> Void) {
        self.surface = surface; self.node = node; self.kind = kind; self.action = action
        self.outstanding = Set(requests); self.completion = completion
    }
    func settle(_ result: XgentActionResult) {
        guard result.surface == surface, outstanding.remove(result.requestId) != nil else { return }
        if !result.ok { finish(false) }
        else if outstanding.isEmpty { finish(true) }
    }
    func finish(_ success: Bool) {
        timeout?.cancel(); timeout = nil
        let complete = completion; completion = nil
        complete?(success)
    }
}
