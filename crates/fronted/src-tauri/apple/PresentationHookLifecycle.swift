import Flow
import SwiftUI

struct XgentHookLifecycle: View {
    let node: XgentNode
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HFlow(itemSpacing: 12, rowSpacing: 12) {
            ForEach(Array((node.children ?? []).enumerated()), id: \.element.id) { index, event in
                HStack(alignment: .center, spacing: 8) {
                    if index > 0 { Image(systemName: "arrow.right").foregroundStyle(.secondary).accessibilityHidden(true) }
                    VStack(alignment: .leading, spacing: 4) {
                        Label(event.label ?? "", systemImage: event.icon ?? "bolt")
                            .fixedSize(horizontal: false, vertical: true)
                        if let phase = event.text {
                            Text(phase).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(10)
                    .background(Color(xgentHex: theme.palette(for: scheme).muted),
                                in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier(event.id)
                }
            }
        }
        .modifier(XgentControlTypography(node: node))
        .accessibilityElement(children: .contain)
    }
}
