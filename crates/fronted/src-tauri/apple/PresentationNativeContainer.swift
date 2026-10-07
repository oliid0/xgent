#if os(macOS)
import AppKit

// A real AppKit ancestor keeps SwiftUI's accessibility proxies in their
// original hierarchy. Promoting those proxies into Tauri's sibling list makes
// AXChildren disagree with AXParent and breaks native accessibility hit tests.
@MainActor
final class XgentNativePresentationContainer: NSView {
    var windowChanged: (() -> Void)?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        windowChanged?()
    }

    init(hostedView: NSView) {
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityEnabled(true)
        setAccessibilityIdentifier("xgent-native-container")
        addSubview(hostedView)
        hostedView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hostedView.leadingAnchor.constraint(equalTo: leadingAnchor),
            hostedView.trailingAnchor.constraint(equalTo: trailingAnchor),
            hostedView.topAnchor.constraint(equalTo: topAnchor),
            hostedView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { return nil }
}
#endif
