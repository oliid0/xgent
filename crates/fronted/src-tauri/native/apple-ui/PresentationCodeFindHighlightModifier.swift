import SwiftUI
import SwiftUIIntrospect

@MainActor
struct XgentCodeFindHighlightModifier: ViewModifier {
    let configuration: XgentCodeFindConfiguration?
    var syntax: XgentCodeSyntaxConfiguration? = nil
    let session: XgentCodeSessionIdentity?
    let store: XgentCodeSessionStore?
    let owner: UUID
    @Environment(\.colorScheme) private var colorScheme
    @StateObject private var highlighting = XgentCodeFindHighlighting()

    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .introspect(.textEditor, on: .iOS(.v26)) { view in
                guard configuration != nil || syntax != nil else { highlighting.detach(); return }
                configure(); highlighting.attach(view); highlighting.update(configuration, syntax: syntax, colorScheme: colorScheme)
            }
            #else
            .introspect(.textEditor, on: .macOS(.v15, .v26)) { view in
                guard configuration != nil || syntax != nil else { highlighting.detach(); return }
                configure(); highlighting.attach(view); highlighting.update(configuration, syntax: syntax, colorScheme: colorScheme)
            }
            #endif
            .onDisappear { highlighting.detach() }
    }
    private func configure() { highlighting.session = session; highlighting.store = store; highlighting.owner = owner }
}
