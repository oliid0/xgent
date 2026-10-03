import SwiftUI
import SwiftUIIntrospect

@MainActor
struct XgentCodeHostAvailability: ViewModifier {
    let enabled: Bool
    let source: XgentCodeHostSource
    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .introspect(.textEditor, on: .iOS(.v26)) { view in
                view.isEditable = enabled
                source.attachInput(read: { [weak view] in view?.text }, commit: { [weak view] in
                    guard let view, view.window != nil else { return false }
                    if view.markedTextRange != nil { view.unmarkText() }
                    return true
                }, resetUndo: { [weak view] in view?.undoManager?.removeAllActions() })
            }
            #else
            .introspect(.textEditor, on: .macOS(.v15, .v26)) { view in
                view.isEditable = enabled
                source.attachInput(read: { [weak view] in view?.string }, commit: { [weak view] in
                    guard let view, view.window != nil else { return false }
                    if view.hasMarkedText() { view.unmarkText() }
                    return true
                }, resetUndo: { [weak view] in view?.undoManager?.removeAllActions() })
            }
            #endif
    }
}
