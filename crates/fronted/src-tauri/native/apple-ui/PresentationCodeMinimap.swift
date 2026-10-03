#if os(macOS)
import AppKit
import SwiftUI

@MainActor
private final class XgentCodeMinimapView: NSView {
    weak var input: XgentCodeNativeInput?
    var source = "" { didSet { if source != oldValue { lines = source.components(separatedBy: .newlines); needsDisplay = true } } }
    var foreground = NSColor.secondaryLabelColor
    private var lines = [""]
    private var observer: NSObjectProtocol?
    override var isFlipped: Bool { true }
    func observe(_ input: XgentCodeNativeInput) {
        guard self.input !== input else { return }
        if let observer { NotificationCenter.default.removeObserver(observer) }
        self.input = input
        observer = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification,
            object: input.scroll.contentView, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.needsDisplay = true }
            }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    override func draw(_ dirtyRect: NSRect) {
        guard let input else { return }
        let step = min(3, bounds.height / CGFloat(max(1, lines.count)))
        let count = min(lines.count, Int(ceil(bounds.height / max(0.1, step))))
        foreground.withAlphaComponent(0.35).setFill()
        for index in 0..<count {
            let prefix = lines[index].prefix(90)
            let leading = prefix.prefix(while: { $0.isWhitespace }).count
            let width = CGFloat(max(0, prefix.count - leading)) * 0.65
            NSRect(x: 4 + CGFloat(leading) * 0.65, y: CGFloat(index) * step, width: min(width, bounds.width - 8), height: max(0.5, step * 0.5)).fill()
        }
        let height = max(input.view.bounds.height, input.scroll.contentSize.height)
        let viewport = input.scroll.contentView.bounds
        let scaledHeight = CGFloat(lines.count) * step
        let marker = CGRect(x: 0, y: viewport.minY / max(1, height) * scaledHeight,
            width: bounds.width, height: max(6, viewport.height / max(1, height) * scaledHeight))
        foreground.withAlphaComponent(0.12).setFill(); marker.intersection(bounds).fill()
    }
    override func mouseDown(with event: NSEvent) { navigate(event) }
    override func mouseDragged(with event: NSEvent) { navigate(event) }
    private func navigate(_ event: NSEvent) {
        guard let input, input.view.isEditable else { return }
        let point = convert(event.locationInWindow, from: nil)
        let height = min(bounds.height, CGFloat(max(1, lines.count)) * 3)
        let viewport = input.scroll.contentView.bounds
        let offset = min(max(0, input.view.bounds.height - viewport.height),
            max(0, point.y / max(1, height) * input.view.bounds.height - viewport.height / 2))
        input.scroll.contentView.scroll(to: CGPoint(x: viewport.minX, y: offset))
        input.scroll.reflectScrolledClipView(input.scroll.contentView)
    }
}

@MainActor
struct XgentCodeMinimap: NSViewRepresentable {
    let input: XgentCodeNativeInput
    let text: String
    let color: String
    func makeNSView(context: Context) -> NSView {
        let view = XgentCodeMinimapView()
        view.setAccessibilityElement(false)
        view.observe(input); view.source = text
        view.foreground = NSColor(Color(xgentHex: color))
        return view
    }
    func updateNSView(_ view: NSView, context: Context) {
        guard let view = view as? XgentCodeMinimapView else { return }
        view.observe(input); view.source = text
        view.foreground = NSColor(Color(xgentHex: color)); view.needsDisplay = true
    }
}
#endif
