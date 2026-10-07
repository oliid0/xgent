import SwiftUI

struct XgentIOSComposerActions: View {
    let nodes: [XgentNode]
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var modelControls: [XgentNode] { nodes.filter { ["model", "context-usage", "runtime-reasoning"].contains($0.id) } }
    private var controls: [XgentNode] { nodes.filter { !["model", "context-usage", "runtime-reasoning"].contains($0.id) } }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            actionRow(nodes)
            expanded
        }
    }

    private var expanded: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !modelControls.isEmpty { actionRow(modelControls) }
            ViewThatFits(in: .horizontal) {
                actionRow(controls)
                separateMode
            }
        }
    }

    private var separateMode: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let safety = controls.first(where: { $0.id == "command-safety" }) {
                control(safety)
                    .fixedSize(horizontal: false, vertical: true)
            }
            actionRow(controls.filter { $0.id != "command-safety" })
        }
    }

    private func actionRow(_ children: [XgentNode]) -> some View {
        HStack(spacing: 6) {
            ForEach(children) { child in
                if child.id == "context-usage" {
                    XgentContextUsage(node: child, document: document, model: model)
                } else if child.id == "model" {
                    control(child)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if child.id == "command-safety" {
                    // An inline candidate must budget for the actual mode text;
                    // separateMode permits long labels to wrap at narrow widths.
                    control(child)
                        .fixedSize(horizontal: true, vertical: true)
                } else {
                    control(child)
                }
            }
        }
    }

    @ViewBuilder private func control(_ child: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: child, document: document, model: model, parentAxis: .horizontal)
        #else
        XgentNodeView(node: child, document: document, model: model)
        #endif
    }
}
