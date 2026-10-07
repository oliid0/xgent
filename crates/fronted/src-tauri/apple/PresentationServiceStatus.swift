import SwiftUI

// Service startup failures remain visible alongside usable independent pages.
// The action stays outside long, scrollable failure details.
struct XgentServiceStatusBanner: View {
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .headline) private var headingSize: CGFloat = 17
    @ScaledMetric(relativeTo: .subheadline) private var detailSize: CGFloat = 15
    @State private var detailHeight: CGFloat = 20
    private var message: XgentNode? { document.nodes.first }

    @ViewBuilder private var actions: some View {
        #if os(iOS)
        XgentIOSNodes(nodes: message?.children ?? [], document: document, model: model, parentAxis: .horizontal)
        #else
        XgentNodeChildren(nodes: message?.children ?? [], document: document, model: model)
        #endif
    }

    private var heading: some View {
        Label(message?.label ?? "", systemImage: message?.icon ?? "exclamationmark.triangle")
            .font(.system(size: headingSize * CGFloat(theme.fontScale), weight: .semibold))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) { heading; Spacer(minLength: 8); actions }
                VStack(alignment: .leading, spacing: 8) { heading; actions }
            }
            if let text = message?.text, !text.isEmpty {
                ScrollView {
                    Text(text).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { detailHeight = $0 }
                }
                .scrollBounceBehavior(.basedOnSize)
                .font(.system(size: detailSize * CGFloat(theme.fontScale)))
                .frame(height: min(detailHeight, 96))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12))
        .accessibilityIdentifier("xgent-native-service-status")
        .modifier(XgentPresentationThemeModifier(theme: document.theme ?? .fallback, appearance: document.appearance))
    }
}
