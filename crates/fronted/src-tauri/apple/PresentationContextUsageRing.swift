import SwiftUI

struct XgentContextUsageRing: View {
    let node: XgentNode

    var ratio: Double { max(0, (node.current ?? 0) / max(node.total ?? 1, 1)) }
    var color: Color { ratio >= 0.8 ? .red : ratio >= 0.5 ? .orange : .green }

    var body: some View {
        ZStack {
            Circle().stroke(Color.primary.opacity(0.16), lineWidth: 2.5)
            Circle().trim(from: 0, to: min(1, ratio))
                .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int(min(999, (ratio * 100).rounded())))%")
                .font(.system(size: 8, weight: .semibold, design: .rounded))
                .monospacedDigit()
        }.frame(width: 28, height: 28)
    }
}
