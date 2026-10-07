import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor final class XgentWorkspaceSearchFieldState: ObservableObject {
    #if os(iOS)
    weak var field: UITextField?
    var composing: Bool { field?.markedTextRange != nil }
    #else
    weak var field: NSTextField?
    var composing: Bool { (field?.currentEditor() as? NSTextInputClient)?.hasMarkedText() == true }
    #endif
}
