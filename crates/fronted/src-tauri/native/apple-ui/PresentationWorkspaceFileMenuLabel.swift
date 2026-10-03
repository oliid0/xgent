import SwiftUI

struct XgentWorkspaceFileMenuLabel: View {
    let node: XgentNode
    let busy: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    private var controlHeight: CGFloat {
        #if os(iOS)
        return 44
        #else
        return typeSize.isAccessibilitySize ? 44 : 32
        #endif
    }

    var body: some View {
        HStack(spacing: 6) {
            if busy || node.options?.contains(where: { $0.value == "$loading" }) == true {
                ProgressView().controlSize(.small)
            } else { Image(systemName: node.icon ?? "arrow.up.forward.app").accessibilityHidden(true) }
            Text(node.label ?? "").modifier(XgentControlTypography(node: node))
        }
        .frame(minHeight: controlHeight)
        .contentShape(Rectangle())
    }
}
