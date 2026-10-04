import SwiftUI
#if os(iOS)
import UIKit

@MainActor
struct XgentCodeRevealLifecycle: UIViewRepresentable {
    let ready: () -> Void
    func makeUIView(context: Context) -> XgentCodeRevealLayoutView { XgentCodeRevealLayoutView() }
    func updateUIView(_ view: XgentCodeRevealLayoutView, context: Context) { view.ready = ready; ready() }
}

@MainActor
final class XgentCodeRevealLayoutView: UIView {
    var ready: (() -> Void)?
    override func didMoveToWindow() { super.didMoveToWindow(); ready?() }
    override func layoutSubviews() { super.layoutSubviews(); ready?() }
}
#else
import AppKit

@MainActor
struct XgentCodeRevealLifecycle: NSViewRepresentable {
    let ready: () -> Void
    func makeNSView(context: Context) -> XgentCodeRevealLayoutView { XgentCodeRevealLayoutView() }
    func updateNSView(_ view: XgentCodeRevealLayoutView, context: Context) { view.ready = ready; ready() }
}

@MainActor
final class XgentCodeRevealLayoutView: NSView {
    var ready: (() -> Void)?
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); ready?() }
    override func layout() { super.layout(); ready?() }
}
#endif
