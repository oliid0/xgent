import SwiftUI

/// Measure the wrapped details at their actual width. Long names should not
/// force a desktop row to stack merely because their ideal single-line width is large.
struct XgentProviderRowLayout: Layout {
    var layoutDirection: LayoutDirection = .leftToRight

    private func measure(_ proposal: ProposedViewSize, _ subviews: Subviews)
        -> (width: CGFloat, details: CGSize, actions: CGSize, inline: Bool) {
        guard subviews.count == 2 else { return (0, .zero, .zero, false) }
        let idealActions = subviews[1].sizeThatFits(.unspecified)
        let idealDetails = subviews[0].sizeThatFits(.unspecified)
        let idealWidth = idealDetails.width + 16 + idealActions.width
        let width = proposal.width.flatMap { $0.isFinite ? max(0, $0) : nil } ?? idealWidth
        let detailWidth = max(0, width - 16 - idealActions.width)
        // Astryx stacks at a 512px list width, before each row's 12px side padding.
        let inline = width > 488 && detailWidth >= 180
        let details = subviews[0].sizeThatFits(ProposedViewSize(width: inline ? detailWidth : width, height: nil))
        let actions = inline ? idealActions : subviews[1].sizeThatFits(ProposedViewSize(width: width, height: nil))
        return (width, details, actions, inline)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let metrics = measure(proposal, subviews)
        return CGSize(width: metrics.width, height: metrics.inline
            ? max(metrics.details.height, metrics.actions.height)
            : metrics.details.height + 8 + metrics.actions.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        let metrics = measure(ProposedViewSize(width: bounds.width, height: nil), subviews)
        let detailWidth = metrics.inline ? max(0, bounds.width - 16 - metrics.actions.width) : bounds.width
        let detailOrigin = CGPoint(x: metrics.inline && layoutDirection == .rightToLeft
            ? bounds.maxX - detailWidth : bounds.minX, y: bounds.minY)
        subviews[0].place(at: detailOrigin, anchor: .topLeading,
            proposal: ProposedViewSize(width: detailWidth, height: metrics.details.height))
        let actionOrigin = metrics.inline
            ? CGPoint(x: layoutDirection == .rightToLeft ? bounds.minX : bounds.maxX - metrics.actions.width,
                      y: bounds.midY - metrics.actions.height / 2)
            : CGPoint(x: bounds.minX, y: bounds.minY + metrics.details.height + 8)
        subviews[1].place(at: actionOrigin, anchor: .topLeading,
            proposal: ProposedViewSize(width: metrics.inline ? metrics.actions.width : bounds.width,
                                      height: metrics.actions.height))
    }
}
