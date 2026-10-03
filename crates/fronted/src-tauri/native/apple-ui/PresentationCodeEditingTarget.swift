import SwiftUI
import SwiftUIIntrospect

struct XgentCodeEditingTarget: ViewModifier {
    @ObservedObject var commands: XgentCodeEditingCommands

    func body(content: Content) -> some View {
        content
            #if os(iOS)
            .introspect(.textEditor, on: .iOS(.v26)) { commands.attach($0) }
            #else
            .introspect(.textEditor, on: .macOS(.v15, .v26)) { commands.attach($0) }
            #endif
    }
}
