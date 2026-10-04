#if os(macOS)
import SwiftUI

/// Measure the value first, then wrap the description in the remaining column.
/// ViewThatFits measures the label's ideal width and would unnecessarily stack
/// every long description even when the actual desktop row has enough space.
struct XgentDesktopSettingsValueLayout: Layout {
    var stacked = false
    private let spacing: CGFloat = 16

    private func measure(_ proposal: ProposedViewSize, _ subviews: Subviews)
        -> (width: CGFloat, label: CGSize, value: CGSize, inline: Bool) {
        guard subviews.count == 2 else { return (0, .zero, .zero, false) }
        let idealValue = subviews[1].sizeThatFits(.unspecified)
        let idealLabel = subviews[0].sizeThatFits(.unspecified)
        let idealWidth = idealLabel.width + spacing + idealValue.width
        let width = proposal.width.flatMap { $0.isFinite ? max(0, $0) : nil } ?? idealWidth
        let labelWidth = max(0, width - spacing - idealValue.width)
        let inline = !stacked && labelWidth >= 180
        let label = subviews[0].sizeThatFits(ProposedViewSize(width: inline ? labelWidth : width, height: nil))
        let value = inline ? idealValue : subviews[1].sizeThatFits(ProposedViewSize(width: width, height: nil))
        return (width, label, value, inline)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let metrics = measure(proposal, subviews)
        let height = metrics.inline ? max(metrics.label.height, metrics.value.height)
            : metrics.label.height + spacing + metrics.value.height
        return CGSize(width: metrics.width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        let metrics = measure(ProposedViewSize(width: bounds.width, height: nil), subviews)
        if metrics.inline {
            let labelWidth = max(0, bounds.width - spacing - metrics.value.width)
            subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.midY - metrics.label.height / 2),
                anchor: .topLeading, proposal: ProposedViewSize(width: labelWidth, height: metrics.label.height))
            subviews[1].place(at: CGPoint(x: bounds.maxX - metrics.value.width, y: bounds.midY - metrics.value.height / 2),
                anchor: .topLeading, proposal: ProposedViewSize(metrics.value))
        } else {
            subviews[0].place(at: bounds.origin, anchor: .topLeading,
                proposal: ProposedViewSize(width: bounds.width, height: metrics.label.height))
            subviews[1].place(at: CGPoint(x: bounds.minX, y: bounds.minY + metrics.label.height + spacing),
                anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: metrics.value.height))
        }
    }
}
#endif
