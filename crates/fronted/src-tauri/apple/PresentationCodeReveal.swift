import CodeEditorView
import SwiftUI
import SwiftUIIntrospect
#if os(iOS)
import UIKit
typealias XgentRevealTextView = UITextView
#else
import AppKit
typealias XgentRevealTextView = NSTextView
#endif

@MainActor
final class XgentCodeRevealState: ObservableObject {
    private var lastRequest: String?
    var session: XgentCodeSessionIdentity?
    var store: XgentCodeSessionStore?
    var owner: UUID?
    private var generation = 0
    private weak var view: XgentRevealTextView?
    private var location: XgentCodeLocation?
    private var text = ""
    private var position: Binding<CodeEditor.Position>?
    private var pending = false
    private var storageObserver: NSObjectProtocol?
    deinit {
        if let storageObserver { NotificationCenter.default.removeObserver(storageObserver) }
    }
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

    func schedule(_ location: XgentCodeLocation?, text: String, position: Binding<CodeEditor.Position>, to view: XgentRevealTextView) {
        if self.view !== view {
            if let storageObserver { NotificationCenter.default.removeObserver(storageObserver) }
            #if os(iOS)
            let storage: NSTextStorage? = view.textStorage
            #else
            let storage = view.textStorage
            #endif
            if let storage {
                // CodeEditorView installs its initial text in updateUIView,
                // after introspection can already resolve an empty input.
                // Resume asynchronously after the real editing batch; never
                // modify TextKit while its notification is being delivered.
                storageObserver = NotificationCenter.default.addObserver(
                    forName: NSTextStorage.didProcessEditingNotification, object: storage, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated { self?.resume() }
                }
            } else { storageObserver = nil }
        }
        self.location = location; self.text = text; self.position = position; self.view = view
        // Introspection can resolve the retained input before it has its real
        // frame. Retry from that input's layout, not only the SwiftUI overlay.
        if let native = view as? XgentCodeNativeTextView {
            native.onRevealReady = { [weak self] in self?.resume() }
        }
        resume()
    }
    func resume() {
        guard !pending, let location, !consumed(location.request), view != nil else { return }
        pending = true
        let revision = generation
        Task { @MainActor [weak self] in
            await Task.yield()
            guard let self, self.generation == revision else { return }
            self.pending = false
            guard let view = self.view else { return }
            self.apply(self.location, text: self.text, to: view)
        }
    }
    func cancel() {
        generation += 1
        if let storageObserver { NotificationCenter.default.removeObserver(storageObserver) }
        storageObserver = nil
        (view as? XgentCodeNativeTextView)?.onRevealReady = nil
        pending = false; view = nil
    }
    private func apply(_ location: XgentCodeLocation?, text: String, to view: XgentRevealTextView) {
        guard ownsSession, let location, !consumed(location.request), view.window != nil,
              view.bounds.width > 0, view.bounds.height > 0 else { return }
        #if os(iOS)
        guard view.text == text else { return }
        #else
        guard view.string == text, let scroll = view.enclosingScrollView,
              scroll.contentSize.width > 0, scroll.contentSize.height > 0 else { return }
        #endif
        let range = location.range(in: text)
        // Introspection may precede window attachment and TextKit's first layout.
        // A native lifecycle callback retries readiness, without polling or
        // selecting once in SwiftUI and then again on a later acknowledgement.
        if let manager = view.textLayoutManager, let storage = manager.textContentManager as? NSTextContentStorage,
           let nativeRange = XgentCodeTextKitRange.native(range, in: storage) {
            manager.ensureLayout(for: nativeRange)
        }
        if let session, let store, let owner { store.finishRestoring(session, owner: owner) }
        #if os(iOS)
        view.layoutIfNeeded()
        view.selectedRange = range
        #else
        scroll.layoutSubtreeIfNeeded()
        view.layoutSubtreeIfNeeded()
        view.setSelectedRange(range)
        #endif
        view.scrollRangeToVisible(range)
        remember(location.request)
        // The package reapplies its position binding on each update. Persist
        // both native selection and scroll offset, including sessionless inputs.
        if let position {
            var next = position.wrappedValue
            next.selections = [range]
            #if os(iOS)
            next.verticalScrollPosition = view.contentOffset.y
            #else
            next.verticalScrollPosition = scroll.contentView.bounds.origin.y
            #endif
            position.wrappedValue = next
        }
    }
}

@MainActor
struct XgentCodeRevealModifier: ViewModifier {
    let location: XgentCodeLocation?
    let text: String
    let position: Binding<CodeEditor.Position>
    var session: XgentCodeSessionIdentity? = nil
    var store: XgentCodeSessionStore? = nil
    var owner: UUID? = nil
    @StateObject private var state = XgentCodeRevealState()

    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .introspect(.xgentCodeEditor, on: .iOS(.v26)) { view in configure(); state.schedule(location, text: text, position: position, to: view) }
            #else
            .introspect(.xgentCodeEditor, on: .macOS(.v15, .v26)) { view in configure(); state.schedule(location, text: text, position: position, to: view) }
            #endif
            .background(XgentCodeRevealLifecycle { state.resume() }.allowsHitTesting(false).accessibilityHidden(true))
            .onDisappear { state.cancel() }
    }
    private func configure() { state.session = session; state.store = store; state.owner = owner }
}
