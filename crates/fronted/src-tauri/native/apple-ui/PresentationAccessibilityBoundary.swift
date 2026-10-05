#if os(macOS)
import AppKit
import WebKit

// WKWebView can publish remote accessibility descendants even when its local
// NSView is accessibility-hidden. Own the relationship at Tauri's plain native
// container instead, so VoiceOver never traverses the covered execution host.
@MainActor
final class XgentPresentationAccessibilityBoundary {
    private weak var container: NSView?
    private weak var transport: WKWebView?
    private var ownsChildren = false

    init(transport: WKWebView) {
        self.transport = transport
        container = transport.superview
    }

    func update(nativeRoot: Bool) {
        guard let container, let transport, transport.superview === container else {
            reset()
            return
        }
        if nativeRoot {
            transport.setAccessibilityHidden(true)
            // Keep every native sibling (including the hosting controller)
            // while excluding the transport before WebKit's remote AX query.
            let nativeChildren = NSAccessibility.unignoredChildren(from:
                container.subviews.filter { $0 !== transport })
            container.setAccessibilityChildren(nativeChildren)
            ownsChildren = true
        } else {
            reset()
        }
    }

    func reset() {
        guard ownsChildren else { return }
        // Tauri's content container otherwise uses AppKit's computed children.
        container?.setAccessibilityChildren(nil)
        transport?.setAccessibilityHidden(false)
        ownsChildren = false
    }
}
#endif
