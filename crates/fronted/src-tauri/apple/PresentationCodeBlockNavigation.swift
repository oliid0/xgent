import SwiftUI

struct XgentCodeBlockScrollGeometry: Equatable {
    let offset: CGPoint
    let contentSize: CGSize
    let viewportSize: CGSize

    func bounded(_ point: CGPoint) -> CGPoint {
        CGPoint(x: min(max(0, point.x), max(0, contentSize.width - viewportSize.width)),
                y: min(max(0, point.y), max(0, contentSize.height - viewportSize.height)))
    }
}

struct XgentCodeBlockNavigation: ViewModifier {
    @ObservedObject var state: XgentCodeBlockState
    let hidden: Bool
    @State private var position = ScrollPosition(idType: Int.self)
    @State private var offset = CGPoint.zero
    @State private var pendingRestore: CGPoint?

    init(state: XgentCodeBlockState, hidden: Bool) {
        self.state = state; self.hidden = hidden
        _pendingRestore = State(initialValue: state.offset)
    }

    func body(content: Content) -> some View {
        content
            .scrollPosition($position)
            .onScrollGeometryChange(for: XgentCodeBlockScrollGeometry.self) {
                .init(offset: $0.contentOffset, contentSize: $0.contentSize, viewportSize: $0.containerSize)
            } action: { _, geometry in
                offset = geometry.offset
                guard !hidden, geometry.viewportSize.width > 0, geometry.viewportSize.height > 1,
                      geometry.contentSize.width > 0, geometry.contentSize.height > 0 else { return }
                if let pendingRestore {
                    let target = geometry.bounded(pendingRestore)
                    if abs(target.x - offset.x) < 1 && abs(target.y - offset.y) < 1 {
                        self.pendingRestore = nil
                        state.offset = geometry.bounded(offset)
                    } else {
                        // Keep the saved point until the native scroll actually
                        // reaches it; the initial zero offset must not erase it.
                        position.scrollTo(point: target)
                    }
                } else {
                    state.offset = geometry.bounded(offset)
                }
            }
            .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow]) { press in
                guard !hidden, press.modifiers.isEmpty else { return .ignored }
                var point = offset
                switch press.key {
                case .upArrow: point.y -= 40
                case .downArrow: point.y += 40
                case .leftArrow: point.x -= 40
                case .rightArrow: point.x += 40
                default: return .ignored
                }
                position.scrollTo(point: point)
                return .handled
            }
    }
}
