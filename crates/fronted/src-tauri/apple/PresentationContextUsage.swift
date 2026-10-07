import SwiftUI

struct XgentContextUsage: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            XgentContextUsageRing(node: node)
                .frame(width: document.formFactor == .mobile ? 44 : 32,
                       height: document.formFactor == .mobile ? 44 : 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        .accessibilityValue(node.accessibilityValue ?? "")
        .help(node.text ?? "")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            XgentContextUsagePopover(node: node, document: document, model: model) { open = false }
                #if os(iOS)
                .presentationCompactAdaptation(.popover)
                #endif
        }
        .onChange(of: node.value?.text) { _, _ in open = false }
    }
}
