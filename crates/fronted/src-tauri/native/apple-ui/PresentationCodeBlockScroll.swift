import SwiftUI

struct XgentCodeBlockScroll<Content: View>: View {
    let maximumHeight: CGFloat?
    var hidden = false
    let state: XgentCodeBlockState
    let content: () -> Content
    @State private var contentHeight: CGFloat = 1

    init(maximumHeight: CGFloat?, hidden: Bool = false, state: XgentCodeBlockState, @ViewBuilder content: @escaping () -> Content) {
        self.maximumHeight = maximumHeight; self.hidden = hidden; self.state = state; self.content = content
        _contentHeight = State(initialValue: max(1, state.contentHeight))
    }

    var body: some View {
        Group {
            if let maximumHeight {
                ScrollView([.horizontal, .vertical]) {
                    content()
                        .fixedSize(horizontal: true, vertical: true)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                            if $0.isFinite && $0 > 0 { contentHeight = $0; state.contentHeight = $0 }
                        }
                }
                .frame(height: hidden ? 0 : min(contentHeight, maximumHeight))
                .focusable(!hidden)
                .modifier(XgentCodeBlockNavigation(state: state, hidden: hidden))
            } else {
                ScrollView(.horizontal) { content().fixedSize(horizontal: true, vertical: true) }
                    .frame(height: hidden ? 0 : nil)
                    .focusable(!hidden)
                    .modifier(XgentCodeBlockNavigation(state: state, hidden: hidden))
            }
        }
        .scrollBounceBehavior(.basedOnSize, axes: [.horizontal, .vertical])
        .clipped()
        .disabled(hidden)
        .allowsHitTesting(!hidden)
        .accessibilityHidden(hidden)
        .accessibilityIdentifier("xgent-code-scroll")
    }
}
