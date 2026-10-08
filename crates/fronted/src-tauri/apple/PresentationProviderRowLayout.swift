import SwiftUI

/// Ordering and the action menu keep their widths; details take the remaining space.
struct XgentProviderRowLayout: Layout {
    var minimumDetailsWidth: CGFloat = 0
    var stacked = false

    private func measure(_ proposal: ProposedViewSize, _ subviews: Subviews)
        -> (width: CGFloat, leading: CGSize, details: CGSize, trailing: CGSize, stacked: Bool) {
        guard subviews.count == 3 else { return (0, .zero, .zero, .zero, false) }
        let leading = subviews[0].sizeThatFits(.unspecified)
        let trailing = subviews[2].sizeThatFits(.unspecified)
        let ideal = subviews[1].sizeThatFits(.unspecified)
        let width = proposal.width.flatMap { $0.isFinite ? max(0, $0) : nil }
            ?? (leading.width + ideal.width + trailing.width + 16)
        let stack = stacked || (minimumDetailsWidth > 0 && width < leading.width + trailing.width + 16 + minimumDetailsWidth)
        let details = subviews[1].sizeThatFits(ProposedViewSize(
            width: stack ? width : max(0, width - leading.width - trailing.width - 16), height: nil))
        return (width, leading, details, trailing, stack)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let measured = measure(proposal, subviews)
        return CGSize(width: measured.width,
                      height: measured.stacked
                        ? measured.details.height + 8 + max(measured.leading.height, measured.trailing.height)
                        : max(measured.leading.height, measured.details.height, measured.trailing.height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 3 else { return }
        let measured = measure(ProposedViewSize(width: bounds.width, height: nil), subviews)
        if measured.stacked {
            subviews[1].place(at: bounds.origin, anchor: .topLeading,
                proposal: ProposedViewSize(width: bounds.width, height: measured.details.height))
            let top = bounds.minY + measured.details.height + 8
            subviews[0].place(at: CGPoint(x: bounds.minX, y: top), anchor: .topLeading,
                proposal: ProposedViewSize(measured.leading))
            subviews[2].place(at: CGPoint(x: bounds.maxX - measured.trailing.width, y: top), anchor: .topLeading,
                proposal: ProposedViewSize(measured.trailing))
            return
        }
        let detailWidth = max(0, bounds.width - measured.leading.width - measured.trailing.width - 16)
        let sizes = [measured.leading, CGSize(width: detailWidth, height: measured.details.height), measured.trailing]
        var offset: CGFloat = 0
        for index in subviews.indices {
            let size = sizes[index]
            // SwiftUI mirrors a custom Layout's logical coordinates in RTL.
            // Mirroring here as well reverses the controls a second time.
            let x = bounds.minX + offset
            subviews[index].place(at: CGPoint(x: x, y: bounds.midY - size.height / 2), anchor: .topLeading,
                                 proposal: ProposedViewSize(width: size.width, height: size.height))
            offset += size.width + 8
        }
    }
}
