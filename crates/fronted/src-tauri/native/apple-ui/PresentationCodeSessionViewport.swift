import CodeEditorView
import SwiftUI
import SwiftUIIntrospect
#if os(iOS)
import UIKit
private typealias XgentCodeSessionTextView = UITextView
#else
import AppKit
private typealias XgentCodeSessionTextView = NSTextView
#endif

@MainActor
private final class XgentCodeSessionViewportState: ObservableObject {
    private var session: XgentCodeSessionIdentity?
    private var store: XgentCodeSessionStore?
    private var owner: UUID?
    private var restored = false
    private var saved = CodeEditor.Position()
    private var horizontal: CGFloat = 0
    private var freshReference = false
    private weak var view: XgentCodeSessionTextView?
    func attach(_ view: XgentCodeSessionTextView, session: XgentCodeSessionIdentity?, store: XgentCodeSessionStore?, owner: UUID, reveal: XgentCodeLocation?) {
        guard let session, let store else { return }
        if self.view === view, self.session == session { restore(); return }
        self.view = view; self.session = session; self.store = store; self.owner = owner; restored = false
        store.viewportAvailability(session, owner: owner) { [weak view] in view?.window != nil && view?.isEditable == true }
        #if os(iOS)
        saved = store.position(session, text: view.text ?? "")
        #else
        saved = store.position(session, text: view.string)
        #endif
        horizontal = store.horizontal(session)
        freshReference = reveal.map { !store.revealed($0.request, session: session) } ?? false
        Task { @MainActor [weak self] in await Task.yield(); self?.restore() }
    }

    func restore() {
        guard !restored, let view, view.window != nil, let session, let store, let owner, store.owns(session, owner: owner) else { return }
        restored = true
        if freshReference { store.finishRestoring(session, owner: owner); return }
        if saved.verticalScrollPosition > 0, let manager = view.textLayoutManager, let range = manager.textContentManager?.documentRange {
            manager.ensureLayout(for: range)
        }
        #if os(iOS)
        view.layoutIfNeeded()
        view.selectedRange = saved.selections.first ?? .zero
        let inset = view.adjustedContentInset
        let offset = CGPoint(x: min(horizontal, max(0, view.contentSize.width - view.bounds.width + inset.right)),
                             y: min(saved.verticalScrollPosition, max(0, view.contentSize.height - view.bounds.height + inset.bottom)))
        // The pinned editor clamps using bounds.height - contentSize.height on UIKit.
        view.setContentOffset(offset, animated: false)
        // UIKit can adjust the scroll anchor after restoring a selection while
        // TextKit finishes its layout. Keep interim callbacks out of the saved
        // session and restore the viewport once that layout batch has finished.
        DispatchQueue.main.async { [weak self, weak view] in
            guard let self, let view, self.view === view, self.session == session,
                  self.owner == owner, self.restored, view.window != nil,
                  store.owns(session, owner: owner) else { return }
            view.layoutIfNeeded()
            if let manager = view.textLayoutManager, let range = manager.textContentManager?.documentRange {
                manager.ensureLayout(for: range)
            }
            let inset = view.adjustedContentInset
            view.setContentOffset(CGPoint(
                x: min(self.horizontal, max(0, view.contentSize.width - view.bounds.width + inset.right)),
                y: min(self.saved.verticalScrollPosition, max(0, view.contentSize.height - view.bounds.height + inset.bottom))),
                animated: false)
            store.finishRestoring(session, owner: owner)
        }
        #else
        guard let scroll = view.enclosingScrollView else { restored = false; return }
        view.setSelectedRanges(saved.selections.map { NSValue(range: $0) }, affinity: .downstream, stillSelecting: false)
        let offset = CGPoint(x: min(horizontal, max(0, view.bounds.width - scroll.contentSize.width)),
                             y: min(saved.verticalScrollPosition, max(0, view.bounds.height - scroll.contentSize.height)))
        scroll.contentView.scroll(to: offset); scroll.reflectScrolledClipView(scroll.contentView)
        #endif
        #if os(macOS)
        store.finishRestoring(session, owner: owner)
        #endif
    }

    func capture() {
        guard let view, let session, let store, let owner, store.owns(session, owner: owner) else { return }
        #if os(iOS)
        store.save(CodeEditor.Position(selections: [view.selectedRange], verticalScrollPosition: view.contentOffset.y),
                   session: session, owner: owner, text: view.text ?? "", horizontal: view.contentOffset.x)
        #else
        let offset = view.enclosingScrollView?.contentView.bounds.origin ?? .zero
        store.save(CodeEditor.Position(selections: view.selectedRanges.map(\.rangeValue), verticalScrollPosition: offset.y),
                   session: session, owner: owner, text: view.string, horizontal: offset.x)
        #endif
        #if os(iOS)
        saved = store.position(session, text: view.text ?? "")
        #else
        saved = store.position(session, text: view.string)
        #endif
        horizontal = store.horizontal(session)
        restored = false
        freshReference = false
        store.release(session, owner: owner)
    }

    func resume() {
        guard let session, let store, let owner else { return }
        store.prepare(session, owner: owner, restoring: true)
        store.viewportAvailability(session, owner: owner) { [weak view] in view?.window != nil && view?.isEditable == true }
        restored = false
        Task { @MainActor [weak self] in await Task.yield(); self?.restore() }
    }
}

@MainActor
struct XgentCodeSessionViewport: ViewModifier {
    let session: XgentCodeSessionIdentity?
    let store: XgentCodeSessionStore?
    let owner: UUID
    let reveal: XgentCodeLocation?
    @StateObject private var state = XgentCodeSessionViewportState()
    @Environment(\.xgentCodeHostParking) private var parking

    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .introspect(.xgentCodeEditor, on: .iOS(.v26)) { view in
                state.attach(view, session: session, store: store, owner: owner, reveal: reveal)
                registerViewport()
            }
            #else
            .introspect(.xgentCodeEditor, on: .macOS(.v15, .v26)) { view in
                state.attach(view, session: session, store: store, owner: owner, reveal: reveal)
                registerViewport()
            }
            #endif
            .onGeometryChange(for: CGSize.self) { $0.size } action: { _ in state.restore() }
            .onAppear {
                Task { @MainActor in await Task.yield(); state.restore() }
            }
            .onDisappear { state.capture() }
    }

    private func registerViewport() {
        parking?.viewport(suspend: { [weak state] in state?.capture() }, resume: { [weak state] in state?.resume() })
    }
}
