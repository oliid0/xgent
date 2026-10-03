import SwiftUI
import SwiftUIIntrospect
#if os(iOS)
import UIKit
private typealias XgentFindTextView = UITextView
#else
import AppKit
private typealias XgentFindTextView = NSTextView
#endif

@MainActor
private final class XgentCodeFindTargetState: ObservableObject {
    let replacement = XgentCodeReplacement()
    private var lastEdit: [String: Int] = [:]
    private var lastReveal: [String: Int] = [:]
    var session: XgentCodeSessionIdentity?
    var store: XgentCodeSessionStore?
    var owner: UUID?

    func apply(_ config: XgentCodeFindConfiguration?, to view: XgentFindTextView,
               acknowledge: ((XgentCodeFindAction) -> Void)?) {
        guard let config, view.window != nil else { return }
        if let session, let store, let owner, !store.owns(session, owner: owner) { return }
        #if os(iOS)
        guard view.markedTextRange == nil else { return }
        #else
        guard !view.hasMarkedText() else { return }
        #endif
        if let edit = config.edit, edit.request > (lastEdit[config.identity] ?? 0) {
            let consumed = consume(edit.request, editing: true, identity: config.identity)
            if consumed {
                if let reveal = config.reveal { _ = consume(reveal.request, editing: false, identity: config.identity) }
                let applied = edit.selection.valid(in: edit.before) && replacement.apply(edit, to: view)
                acknowledge?(action("ack", config: config, view: view, editRequest: edit.request, applied: applied))
            }
            return
        }
        if let reveal = config.reveal, reveal.request > (lastReveal[config.identity] ?? 0),
           consume(reveal.request, editing: false, identity: config.identity) {
            guard config.open, reveal.selection.valid(in: source(view)), reveal.before == source(view) else { return }
            #if os(iOS)
            view.selectedRange = reveal.selection.range
            #else
            view.setSelectedRange(reveal.selection.range)
            #endif
            view.scrollRangeToVisible(reveal.selection.range)
        }
    }
    private func consume(_ request: Int, editing: Bool, identity: String) -> Bool {
        if editing { lastEdit[identity] = request } else { lastReveal[identity] = request }
        if let session, let store, let owner { return store.consumeFind(request, editing: editing, session: session, owner: owner) }
        return true
    }
    private func source(_ view: XgentFindTextView) -> String {
        #if os(iOS)
        return view.text ?? ""
        #else
        return view.string
        #endif
    }
    private func action(_ command: String, config: XgentCodeFindConfiguration, view: XgentFindTextView,
                        editRequest: Int, applied: Bool) -> XgentCodeFindAction {
        #if os(iOS)
        let ranges = [view.selectedRange]
        #else
        let ranges = view.selectedRanges.map(\.rangeValue)
        #endif
        return XgentCodeFindAction(command: command, content: source(view), query: config.query, replacement: config.replacement,
                                  options: config.options, selections: ranges.map { .init(location: $0.location, length: $0.length) },
                                  editRequest: editRequest, applied: applied)
    }
}

@MainActor
struct XgentCodeFindTarget: ViewModifier {
    let configuration: XgentCodeFindConfiguration?
    let acknowledge: ((XgentCodeFindAction) -> Void)?
    let session: XgentCodeSessionIdentity?
    let store: XgentCodeSessionStore?
    let owner: UUID
    @StateObject private var state = XgentCodeFindTargetState()

    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .introspect(.textEditor, on: .iOS(.v26)) { view in configure(); state.apply(configuration, to: view, acknowledge: acknowledge) }
            #else
            .introspect(.textEditor, on: .macOS(.v15, .v26)) { view in configure(); state.apply(configuration, to: view, acknowledge: acknowledge) }
            #endif
    }
    private func configure() { state.session = session; state.store = store; state.owner = owner }
}
