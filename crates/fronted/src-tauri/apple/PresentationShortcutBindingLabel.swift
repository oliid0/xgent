#if os(macOS)
import SwiftUI

// Keep the action and recorded key together when space permits. At large text
// sizes or narrow settings widths, both remain readable on separate lines.
struct XgentShortcutBindingLabel: View {
    let node: XgentNode
    @Environment(\.dynamicTypeSize) private var textSize

    private var action: some View {
        Label(node.label ?? "", systemImage: "keyboard")
            .fixedSize(horizontal: false, vertical: true)
    }

    private var key: some View {
        Text(XgentShortcutKeys.display(node.text ?? ""))
            .monospaced()
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            .fixedSize(horizontal: false, vertical: true)
    }

    var body: some View {
        if textSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) { action; key }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { action; key }
                VStack(alignment: .leading, spacing: 8) { action; key }
            }
        }
    }
}
#endif
