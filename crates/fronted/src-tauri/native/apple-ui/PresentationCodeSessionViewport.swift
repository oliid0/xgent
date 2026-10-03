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
        if freshReference { return }
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
        #else
        guard let scroll = view.enclosingScrollView else { restored = false; return }
        view.setSelectedRanges(saved.selections.map { NSValue(range: $0) }, affinity: .downstream, stillSelecting: false)
        let offset = CGPoint(x: min(horizontal, max(0, view.bounds.width - scroll.contentSize.width)),
                             y: min(saved.verticalScrollPosition, max(0, view.bounds.height - scroll.contentSize.height)))
        scroll.contentView.scroll(to: offset); scroll.reflectScrolledClipView(scroll.contentView)
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
        store.release(session, owner: owner)
    }
}

@MainActor
struct XgentCodeSessionViewport: ViewModifier {
    let session: XgentCodeSessionIdentity?
    let store: XgentCodeSessionStore?
    let owner: UUID
    let reveal: XgentCodeLocation?
    @StateObject private var state = XgentCodeSessionViewportState()

    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .introspect(.textEditor, on: .iOS(.v26)) { state.attach($0, session: session, store: store, owner: owner, reveal: reveal) }
            #else
            .introspect(.textEditor, on: .macOS(.v15, .v26)) { state.attach($0, session: session, store: store, owner: owner, reveal: reveal) }
            #endif
            .onGeometryChange(for: CGSize.self) { $0.size } action: { _ in state.restore() }
            .onDisappear { state.capture() }
    }
}
