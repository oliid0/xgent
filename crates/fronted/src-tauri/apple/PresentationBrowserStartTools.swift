import SwiftUI

struct XgentBrowserStartTools: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @State private var availableWidth: CGFloat = 0

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(minimum: 0), spacing: 12, alignment: .leading),
              count: !textSize.isAccessibilitySize && availableWidth >= 532 ? 2 : 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let label = node.label {
                Text(label).font(.headline).accessibilityAddTraits(.isHeader)
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                ForEach(node.children ?? []) { item in
                    Button { model.send(item, in: document) } label: {
                        HStack(spacing: 12) {
                            if let icon = item.icon { Image(systemName: icon).accessibilityHidden(true) }
                            Text(item.label ?? "").multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .contentShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.roundedRectangle(radius: CGFloat(theme.radius.element)))
                    .tint(Color(xgentHex: theme.palette(for: colorScheme).text))
                    .disabled(item.disabled == true || model.isBusy(item, in: document))
                    .accessibilityIdentifier(item.id)
                }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
            if width.isFinite && width >= 0 && width < 10000 { availableWidth = width }
        }
        .frame(maxWidth: 720, alignment: .leading)
        .padding(16)
    }
}
