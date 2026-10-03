import Flow
import SwiftUI

struct XgentWorkspaceFileToolbar: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    private var title: XgentNode? { node.children?.first { $0.id == "workspace-file-title" } }
    private var controls: [XgentNode] { (node.children ?? []).filter { $0.id != "workspace-file-title" } }

    var body: some View {
        Group {
            if textSize.isAccessibilitySize { stacked }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        heading.fixedSize(horizontal: true, vertical: true)
                        Spacer(minLength: 0)
                        actions.fixedSize(horizontal: true, vertical: true)
                    }
                    stacked
                }
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: 8) { heading; actions }
    }

    @ViewBuilder private var heading: some View {
        if let title {
            Text(title.text ?? title.label ?? "").modifier(XgentControlTypography(node: title)).fontWeight(.semibold)
                .lineLimit(2).textSelection(.enabled).accessibilityIdentifier(title.id)
        }
    }

    private var actions: some View {
        HFlow(itemSpacing: 8, rowSpacing: 8) {
            #if os(iOS)
            XgentIOSNodes(nodes: controls, document: document, model: model)
            #else
            XgentNodeChildren(nodes: controls, document: document, model: model)
            #endif
        }
    }
}
