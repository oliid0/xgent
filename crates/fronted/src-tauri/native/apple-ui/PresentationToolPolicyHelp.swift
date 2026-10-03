import SwiftUI

struct XgentToolPolicyHelp: View {
    let node: XgentNode
    @Environment(\.dynamicTypeSize) private var textSize

    private var items: [XgentNode] { node.children ?? [] }

    private func explanation(_ item: XgentNode) -> some View {
        Text(item.text ?? "")
            .modifier(XgentControlTypography(node: item))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items) { explanation($0) }
        }
    }

    var body: some View {
        if textSize.isAccessibilitySize { vertical }
        else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(items) { explanation($0).frame(minWidth: 140) }
                }
                vertical
            }
        }
    }
}
