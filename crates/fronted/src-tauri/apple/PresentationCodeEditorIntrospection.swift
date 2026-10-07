import SwiftUI
@_spi(Advanced) import SwiftUIIntrospect
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// The editor contains a minimap and can sit beside the find bar's field editor.
// Resolve inside its own scroll view, rather than accepting any NSTextView.
struct XgentCodeEditorType: IntrospectableViewType {}

extension IntrospectableViewType where Self == XgentCodeEditorType {
    static var xgentCodeEditor: Self { .init() }
}

#if os(iOS)
extension iOSViewVersion<XgentCodeEditorType, UITextView> {
    static let v26 = Self(for: .v26)
}
#else
@MainActor
private func codeInput(in view: NSView) -> NSTextView? {
    if let input = view as? NSTextView, !input.isFieldEditor,
       input.isSelectable, !String(describing: type(of: input)).contains("Minimap") {
        return input
    }
    for child in view.subviews {
        if let input = codeInput(in: child) { return input }
    }
    return nil
}

extension macOSViewVersion<XgentCodeEditorType, NSTextView> {
    static let v15 = Self(for: .v15, selector: .from(NSScrollView.self, selector: { codeInput(in: $0) }))
    static let v26 = Self(for: .v26, selector: .from(NSScrollView.self, selector: { codeInput(in: $0) }))
}
#endif
