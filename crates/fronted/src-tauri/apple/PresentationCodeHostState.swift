import SwiftUI

// Keep the hosting root installed for the lifetime of an open file. Updating
// its configuration must not replace the native text view and its undo stack.
@MainActor
final class XgentCodeHostState: ObservableObject {
    struct Snapshot {
        let lease: UUID
        let configuration: XgentCodeEditor
        let environment: XgentCodeHostEnvironment
    }
    @Published var snapshot: Snapshot?
    private var generation = 0

    func schedule(_ next: Snapshot, source: XgentCodeHostSource) {
        generation += 1
        let revision = generation
        // Representable updates occur inside a SwiftUI render transaction.
        // Publish after it finishes and reject a superseded mount's update.
        Task { @MainActor [weak self, weak source] in
            await Task.yield()
            guard let self, self.generation == revision, source?.owns(next.lease) == true else { return }
            self.snapshot = next
        }
    }
    func clear() {
        generation += 1
        snapshot = nil
    }
}
