#if os(macOS)
import AppKit
import SwiftUI

// Explicit pane extents avoid HSplitView's content-size constraints feeding
// hosted editor measurements back into the real Tauri window. The finite-frame
// approach was checked against stevengharris/SplitView 3.5.3; this divider uses
// the application's existing point-based preferences and accessibility APIs.
struct XgentPaneDivider: View {
    let axis: Axis
    let extent: CGFloat
    let limits: ClosedRange<CGFloat>
    var reversed = false
    let label: String
    let identifier: String
    let resize: (CGFloat) -> Void
    @State private var dragOrigin: CGFloat?

    private func apply(_ proposed: CGFloat) {
        guard proposed.isFinite else { return }
        resize(min(limits.upperBound, max(limits.lowerBound, proposed)))
    }

    var body: some View {
        ZStack {
            Color.clear
            Rectangle().fill(Color(nsColor: .separatorColor))
                .frame(width: axis == .horizontal ? 1 : nil,
                       height: axis == .vertical ? 1 : nil)
        }
        .frame(width: axis == .horizontal ? 8 : nil,
               height: axis == .vertical ? 8 : nil)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { value in
                if dragOrigin == nil { dragOrigin = extent }
                let delta = axis == .horizontal ? value.translation.width : value.translation.height
                apply((dragOrigin ?? extent) + (reversed ? -delta : delta))
            }
            .onEnded { _ in dragOrigin = nil })
        .onHover { inside in
            if inside { (axis == .horizontal ? NSCursor.resizeLeftRight : NSCursor.resizeUpDown).set() }
            else { NSCursor.arrow.set() }
        }
        .onDisappear { dragOrigin = nil; NSCursor.arrow.set() }
        .focusable()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
            let delta: CGFloat
            switch (axis, press.key) {
            case (.horizontal, .leftArrow), (.vertical, .upArrow): delta = -16
            case (.horizontal, .rightArrow), (.vertical, .downArrow): delta = 16
            default: return .ignored
            }
            apply(extent + (reversed ? -delta : delta))
            return .handled
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue("\(Int(extent))")
        .accessibilityIdentifier(identifier)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: apply(extent + 16)
            case .decrement: apply(extent - 16)
            @unknown default: break
            }
        }
    }
}
#endif
