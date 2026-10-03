import SwiftUI
#if os(iOS)
import UIKit

@MainActor
final class XgentCodeHostingController: UIHostingController<AnyView> {
    let sessionUndo = UndoManager()
    override var undoManager: UndoManager? { sessionUndo }
    init() { super.init(rootView: AnyView(EmptyView())) }
    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Use init()") }
}
#else
import AppKit

@MainActor
final class XgentCodeHostingView: NSHostingView<AnyView> {
    let sessionUndo = UndoManager()
    override var undoManager: UndoManager? { sessionUndo }
    required init(rootView: AnyView) { super.init(rootView: rootView) }
    convenience init() { self.init(rootView: AnyView(EmptyView())) }
    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Use init()") }
}
#endif

@MainActor
final class XgentCodeHost {
    let source: XgentCodeHostSource
    let identity: XgentCodeSessionIdentity
    #if os(iOS)
    let hosting = XgentCodeHostingController()
    var undo: UndoManager { hosting.sessionUndo }
    #else
    let hosting = XgentCodeHostingView()
    var undo: UndoManager { hosting.sessionUndo }
    #endif
    init(session: XgentCodeSessionIdentity, content: String) {
        identity = session; source = XgentCodeHostSource(content)
    }
    func update(lease: UUID, configuration: XgentCodeEditor, content: String, environment: XgentCodeHostEnvironment,
                changed: @escaping (String) -> Void) {
        // An explicit disk reload replaces the model, like Monaco setValue.
        // Ordinary save, hide and switch keep both storage and undo intact.
        let alreadyInNativeView = source.inputContent == content
        if source.activate(lease, content: content, editable: configuration.enabled && environment.enabled, changed: changed) && !alreadyInNativeView {
            undo.removeAllActions()
        }
        let root = XgentCodeHostRoot(source: source, lease: lease, configuration: configuration,
                                     environment: environment, undo: undo)
        hosting.rootView = AnyView(root.id(identity.cacheKey))
    }
    func detach(_ lease: UUID) {
        guard source.owns(lease) else { return }
        source.commitCurrent()
        source.detach(lease)
        #if os(iOS)
        hosting.view.endEditing(true)
        if hosting.parent != nil { hosting.willMove(toParent: nil) }
        hosting.view.removeFromSuperview(); hosting.removeFromParent()
        #else
        if let responder = hosting.window?.firstResponder as? NSView, responder.isDescendant(of: hosting) {
            hosting.window?.makeFirstResponder(nil)
        }
        hosting.removeFromSuperview()
        #endif
    }
    func retire() {
        source.retire(); undo.removeAllActions()
        #if os(iOS)
        hosting.view.endEditing(true)
        if hosting.parent != nil { hosting.willMove(toParent: nil) }
        hosting.view.removeFromSuperview(); hosting.removeFromParent()
        #else
        hosting.removeFromSuperview()
        #endif
        hosting.rootView = AnyView(EmptyView())
    }
}
