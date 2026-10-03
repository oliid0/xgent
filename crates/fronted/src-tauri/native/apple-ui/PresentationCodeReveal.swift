import SwiftUI
import SwiftUIIntrospect
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor
private final class XgentCodeRevealState: ObservableObject {
    private var lastRequest: String?
    var session: XgentCodeSessionIdentity?
    var store: XgentCodeSessionStore?
    var owner: UUID?
    private var generation = 0
    private func consumed(_ request: String) -> Bool {
        lastRequest == request || (session.flatMap { session in store.map { $0.revealed(request, session: session) } } ?? false)
    }
    private var ownsSession: Bool {
        guard let session, let store, let owner else { return true }
        return store.owns(session, owner: owner)
    }
    private func remember(_ request: String) {
        lastRequest = request
        if let session, let store, let owner { store.markRevealed(request, session: session, owner: owner) }
    }

    #if os(iOS)
    func schedule(_ location: XgentCodeLocation?, text: String, to view: UITextView) {
        generation += 1
        let revision = generation
        Task { @MainActor [weak self, weak view] in
            await Task.yield()
            guard let self, let view, self.generation == revision else { return }
            self.apply(location, text: text, to: view)
        }
    }
    func apply(_ location: XgentCodeLocation?, text: String, to view: UITextView) {
        guard ownsSession, let location, !consumed(location.request), view.window != nil, view.text == text else { return }
        let range = location.range(in: text)
        prepare(range, text: text)
        view.selectedRange = range
        view.scrollRangeToVisible(range)
        remember(location.request)
    }
    #else
    func schedule(_ location: XgentCodeLocation?, text: String, to view: NSTextView) {
        generation += 1
        let revision = generation
        Task { @MainActor [weak self, weak view] in
            await Task.yield()
            guard let self, let view, self.generation == revision else { return }
            self.apply(location, text: text, to: view)
        }
    }
    func apply(_ location: XgentCodeLocation?, text: String, to view: NSTextView) {
        guard ownsSession, let location, !consumed(location.request), view.window != nil, view.string == text else { return }
        let range = location.range(in: text)
        prepare(range, text: text)
        view.setSelectedRange(range)
        view.scrollRangeToVisible(range)
        remember(location.request)
    }
    #endif

    private func prepare(_ range: NSRange, text: String) {
        guard let session, let store, let owner else { return }
        // A reference takes precedence over the initial viewport restore.
        // Store its selection before the native delegate's next update reads
        // the position binding, rather than marking an unsaved reveal consumed.
        var position = store.position(session, text: text)
        position.selections = [range]
        store.finishRestoring(session, owner: owner)
        store.save(position, session: session, owner: owner, text: text)
    }
}

@MainActor
struct XgentCodeRevealModifier: ViewModifier {
    let location: XgentCodeLocation?
    let text: String
    var session: XgentCodeSessionIdentity? = nil
    var store: XgentCodeSessionStore? = nil
    var owner: UUID? = nil
    @StateObject private var state = XgentCodeRevealState()

    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .introspect(.xgentCodeEditor, on: .iOS(.v26)) { view in configure(); state.schedule(location, text: text, to: view) }
            #else
            .introspect(.xgentCodeEditor, on: .macOS(.v15, .v26)) { view in configure(); state.schedule(location, text: text, to: view) }
            #endif
    }
    private func configure() { state.session = session; state.store = store; state.owner = owner }
}
