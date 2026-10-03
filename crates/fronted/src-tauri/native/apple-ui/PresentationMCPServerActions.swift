import SwiftUI

struct XgentMCPServerActions: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    @ViewBuilder private func control(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    private var toggle: XgentNode? { node.children?.first { $0.kind == .toggle } }
    private var policy: XgentNode? { node.children?.first { $0.kind == .segmentedControl } }
    private var buttons: [XgentNode] { (node.children ?? []).filter { $0.kind == .iconButton } }

    private var tools: some View {
        HStack(spacing: 8) { ForEach(buttons) { control($0) } }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if let toggle { control(toggle) }
                Spacer(minLength: 0)
                tools
            }
            if let policy { control(policy) }
        }
    }

    var body: some View {
        Group {
            if document.formFactor == "mobile" || textSize.isAccessibilitySize { vertical }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        if let toggle { control(toggle) }
                        if let policy { control(policy).frame(minWidth: 200) }
                        tools
                    }
                    vertical
                }
            }
        }
        .environment(\.xgentSettingsRow, false)
    }
}
