import Foundation

// A read-only request owns its reply and timeout; it never creates an edit,
// marks a visible control busy or turns a failed highlight into a chat error.
@MainActor
final class XgentCodeHighlightQuery {
    let surface: String
    let node: String
    let action: String
    let kind: String
    let diagram: Bool
    private var continuation: CheckedContinuation<String?, Never>?
    var timeout: Task<Void, Never>?

    init(surface: String, node: String, action: String, kind: String, continuation: CheckedContinuation<String?, Never>, diagram: Bool = false) {
        self.surface = surface; self.node = node; self.action = action; self.kind = kind; self.continuation = continuation
        self.diagram = diagram
    }

    func finish(_ value: String?) {
        timeout?.cancel(); timeout = nil
        let pending = continuation; continuation = nil
        pending?.resume(returning: value)
    }
}
