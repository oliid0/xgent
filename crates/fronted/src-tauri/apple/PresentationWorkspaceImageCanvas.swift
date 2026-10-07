import SwiftUI

struct XgentWorkspaceImageCanvas: View {
    let encoded: String
    let label: String
    let rotation: Double
    @Binding var zoom: CGFloat
    @GestureState private var magnification: CGFloat = 1
    @Environment(\.displayScale) private var displayScale

    static func clamped(_ value: CGFloat) -> CGFloat { min(4, max(0.25, value)) }

    var body: some View {
        GeometryReader { proxy in
            let width = max(1, proxy.size.width - 24), height = max(1, proxy.size.height - 24)
            let scale = Self.clamped(zoom * magnification)
            let quarterTurn = XgentImageRotationDraft.normalized(rotation).truncatingRemainder(dividingBy: 180) == 90
            let imageWidth = (quarterTurn ? height : width) * scale
            let imageHeight = (quarterTurn ? width : height) * scale
            let pixels = Float(min(4096, max(256, ceil(max(width, height) * displayScale * zoom / 256) * 256)))
            ScrollView([.horizontal, .vertical]) {
                XgentDataImage(encoded: encoded, maximumPixelSize: pixels, contentMode: .fit,
                               label: label, retryable: true) { Color.secondary.opacity(0.06) }
                    .frame(width: imageWidth, height: imageHeight)
                    .rotationEffect(.degrees(rotation))
                    .frame(width: max(width, width * scale), height: max(height, height * scale))
                    .padding(12)
            }
            .simultaneousGesture(MagnifyGesture()
                .updating($magnification) { value, state, _ in state = value.magnification }
                .onEnded { zoom = Self.clamped(zoom * $0.magnification) })
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: zoom = Self.clamped(zoom + 0.25)
                case .decrement: zoom = Self.clamped(zoom - 0.25)
                @unknown default: break
                }
            }
            .accessibilityLabel(label)
        }
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 120, maxHeight: .infinity)
    }
}
