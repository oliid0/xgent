import SwiftUI

private struct XgentCodeBlockViewportKey: EnvironmentKey {
    static let defaultValue: CGFloat = 720
}

extension EnvironmentValues {
    var xgentCodeBlockViewportHeight: CGFloat {
        get { self[XgentCodeBlockViewportKey.self] }
        set { self[XgentCodeBlockViewportKey.self] = newValue }
    }
}

// Measure the application surface, never the growing code block or transcript.
struct XgentCodeBlockViewport: ViewModifier {
    @State private var height: CGFloat = 720

    func body(content: Content) -> some View {
        content
            .environment(\.xgentCodeBlockViewportHeight, height)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                if $0.isFinite && $0 > 0 { height = $0 }
            }
    }
}
