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
}
