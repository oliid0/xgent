#if os(iOS)
import UIKit
typealias XgentCodeMountBase = UIView
#else
import AppKit
typealias XgentCodeMountBase = NSView
#endif

// Save and park before an enclosing SwiftUI view leaves its window. Waiting
// for dismantle alone can let the hosting graph destroy the native editor.
@MainActor
final class XgentCodeMountView: XgentCodeMountBase {
    weak var entry: XgentCodeHost?
    var lease: UUID?

    #if os(iOS)
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { entry?.rememberWindow(self) }
    }
    override func willMove(toSuperview newSuperview: UIView?) {
        if newSuperview == nil, window != nil, let lease { entry?.detach(lease) }
        super.willMove(toSuperview: newSuperview)
    }
    override func willMove(toWindow newWindow: UIWindow?) {
        if newWindow == nil, window != nil, let lease { entry?.detach(lease) }
        super.willMove(toWindow: newWindow)
    }
    #else
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil { entry?.rememberWindow(self) }
    }
    override func viewWillMove(toSuperview newSuperview: NSView?) {
        if newSuperview == nil, window != nil, let lease { entry?.detach(lease) }
        super.viewWillMove(toSuperview: newSuperview)
    }
    override func viewWillMove(toWindow newWindow: NSWindow?) {
        if newWindow == nil, window != nil, let lease { entry?.detach(lease) }
        super.viewWillMove(toWindow: newWindow)
    }
    #endif
}
