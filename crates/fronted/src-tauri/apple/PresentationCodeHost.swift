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
    private let state = XgentCodeHostState()
    private let parking = XgentCodeHostParking()
    private let nativeInput: XgentCodeNativeInput
    var evidence: [String: String] {
        var result = parking.evidence
        result["scope"] = identity.scope
        result["session"] = identity.key
        result["hosting"] = String(describing: ObjectIdentifier(hosting))
        #if os(iOS)
        result["hostingInWindow"] = String(hosting.viewIfLoaded?.window != nil)
        result["hostingHidden"] = String(hosting.viewIfLoaded?.isHidden ?? true)
        #else
        result["hostingInWindow"] = String(hosting.window != nil)
        result["hostingHidden"] = String(hosting.isHiddenOrHasHiddenAncestor)
        #endif
        result["sourceUTF16Length"] = String(source.content.utf16.count)
        return result
    }
    #if os(iOS)
    let hosting = XgentCodeHostingController()
    var undo: UndoManager { hosting.sessionUndo }
    #else
    let hosting = XgentCodeHostingView()
    var undo: UndoManager { hosting.sessionUndo }
    #endif
    init(session: XgentCodeSessionIdentity, content: String) {
        identity = session; source = XgentCodeHostSource(content)
        nativeInput = XgentCodeNativeInput(content: content)
        hosting.rootView = AnyView(XgentCodeHostRoot(source: source, state: state, parking: parking, nativeInput: nativeInput).id(identity.cacheKey))
    }
    #if os(iOS)
    func rememberWindow(_ mount: UIView) { parking.remember(mount) }
    #else
    func rememberWindow(_ mount: NSView) { parking.remember(mount) }
    #endif
    func update(lease: UUID, configuration: XgentCodeEditor, content: String, environment: XgentCodeHostEnvironment,
                changed: @escaping (String) -> Void) {
        // An explicit disk reload replaces the model, like Monaco setValue.
        // Ordinary save, hide and switch keep both storage and undo intact.
        let alreadyInNativeView = source.inputContent == content
        if source.activate(lease, content: content, editable: configuration.enabled && environment.enabled, changed: changed) && !alreadyInNativeView {
            undo.removeAllActions()
            source.clearInputUndo()
        }
        nativeInput.rebind(text: source.binding(lease))
        state.schedule(.init(lease: lease, configuration: configuration, environment: environment), source: source)
        parking.resume()
        nativeInput.view.isEditable = configuration.enabled && environment.enabled
    }
    func detach(_ lease: UUID) {
        guard source.owns(lease) else { return }
        source.commitCurrent()
        parking.suspend()
        source.detach(lease)
        #if os(iOS)
        hosting.view.endEditing(true)
        if parking.park(hosting) { return }
        if hosting.parent != nil { hosting.willMove(toParent: nil) }
        hosting.view.removeFromSuperview(); hosting.removeFromParent()
        #else
        if let responder = hosting.window?.firstResponder as? NSView, responder.isDescendant(of: hosting) {
            hosting.window?.makeFirstResponder(nil)
        }
        if parking.park(hosting) { return }
        hosting.removeFromSuperview()
        #endif
    }
    func retire() {
        nativeInput.retire()
        source.retire(); undo.removeAllActions()
        state.clear()
        #if os(iOS)
        hosting.view.endEditing(true)
        if hosting.parent != nil { hosting.willMove(toParent: nil) }
        hosting.view.removeFromSuperview(); hosting.removeFromParent()
        #else
        hosting.removeFromSuperview()
        #endif
        hosting.rootView = AnyView(EmptyView())
        parking.clear()
    }
}
