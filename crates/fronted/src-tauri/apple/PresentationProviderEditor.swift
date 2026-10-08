import SwiftUI

// The editor's final actions remain outside its scrolling details on both
// Apple form factors. Each actual button owns its full equal-width label.
struct XgentProviderEditorFooter: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        XgentProviderEditorActionsLayout(spacing: CGFloat(node.spacing ?? 8)) {
            ForEach(node.children ?? []) { action in
                XgentActionButton(node: action, document: document, model: model)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background { XgentThemeBackground() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(node.id)
    }
}

// Measure the real scaled labels before choosing equal-width columns. A narrow
// two-column row must not fragment long action names into single-letter lines.
private struct XgentProviderEditorActionsLayout: Layout {
    var spacing: CGFloat

    private func measure(_ proposal: ProposedViewSize, _ subviews: Subviews)
        -> (width: CGFloat, sizes: [CGSize], stacked: Bool) {
        guard !subviews.isEmpty else { return (0, [], false) }
        let count = CGFloat(subviews.count)
        let gaps = spacing * (count - 1)
        let idealWidth = (subviews.map { $0.sizeThatFits(.unspecified).width }.max() ?? 0) * count + gaps
        let width = proposal.width.flatMap { $0.isFinite ? max(0, $0) : nil } ?? idealWidth
        let stacked = idealWidth > width + 1
        let columnWidth = stacked ? width : max(0, (width - gaps) / count)
        let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil)) }
        return (width, sizes, stacked)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let metrics = measure(proposal, subviews)
        let height = metrics.stacked
            ? metrics.sizes.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, subviews.count - 1))
            : metrics.sizes.map(\.height).max() ?? 0
        return CGSize(width: metrics.width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let metrics = measure(ProposedViewSize(width: bounds.width, height: nil), subviews)
        var offset: CGFloat = 0
        for index in subviews.indices {
            let size = metrics.sizes[index]
            let origin = metrics.stacked
                ? CGPoint(x: bounds.minX, y: bounds.minY + offset)
                : CGPoint(x: bounds.minX + offset, y: bounds.midY - size.height / 2)
            subviews[index].place(at: origin, anchor: .topLeading, proposal: ProposedViewSize(size))
            offset += (metrics.stacked ? size.height : size.width) + spacing
        }
    }
}
