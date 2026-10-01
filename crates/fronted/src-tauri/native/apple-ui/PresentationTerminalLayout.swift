import SwiftUI

private struct XgentTerminalChromeHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Terminal content owns scrolling; connection forms have a separate bounded scrollport.
struct XgentTerminalLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var chromeHeight: CGFloat = 0

    private var viewport: XgentNode? { node.children?.first { $0.kind == .terminalViewport } }
    private var chrome: [XgentNode] { (node.children ?? []).filter { $0.kind != .terminalViewport } }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) { nodes(chrome) }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(GeometryReader { content in
                            Color.clear.preference(key: XgentTerminalChromeHeight.self, value: content.size.height)
                        })
                }
                .frame(height: viewport == nil ? geometry.size.height :
                    min(chromeHeight, max(0, geometry.size.height - 300)))
                if let viewport {
                    nodes([viewport]).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .onPreferenceChange(XgentTerminalChromeHeight.self) { chromeHeight = $0 }
        .frame(idealWidth: 960, maxWidth: .infinity,
               minHeight: 480, idealHeight: 640, maxHeight: .infinity)
    }

    @ViewBuilder private func nodes(_ nodes: [XgentNode]) -> some View {
        #if os(iOS)
        XgentIOSNodes(nodes: nodes, document: document, model: model, parentAxis: .vertical)
        #else
        XgentNodeChildren(nodes: nodes, document: document, model: model)
        #endif
    }
}

extension XgentNodeView {
    var nativeTerminalLayout: some View { XgentTerminalLayout(node: node, document: document, model: model) }
}
