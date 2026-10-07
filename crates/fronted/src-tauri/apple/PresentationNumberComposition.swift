import SwiftUI
import SwiftUIIntrospect
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor final class XgentNumberComposition: ObservableObject {
    #if os(iOS)
    weak var field: UITextField?
    var marked: Bool { field?.markedTextRange != nil }
    func committedText() -> String? { field?.unmarkText(); return field?.text }
    #else
    weak var field: NSTextField?
    var marked: Bool { (field?.currentEditor() as? NSTextView)?.hasMarkedText() == true }
    func committedText() -> String? {
        if let editor = field?.currentEditor() as? NSTextView { editor.unmarkText(); return editor.string }
        return field?.stringValue
    }
    #endif
}

struct XgentNumberCompositionTarget: ViewModifier {
    let composition: XgentNumberComposition
    func body(content: Content) -> some View {
        #if os(iOS)
        content.introspect(.textField, on: .iOS(.v26)) { composition.field = $0 }
        #else
        content.introspect(.textField, on: .macOS(.v15, .v26)) { composition.field = $0 }
        #endif
    }
}
