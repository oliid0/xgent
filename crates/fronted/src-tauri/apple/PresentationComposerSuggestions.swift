import SwiftUI

struct XgentComposerSuggestions: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @ObservedObject private var keyboard: XgentComposerKeyboardState
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.xgentPresentationTheme) private var theme
    var floatsAboveInput = false
    @ScaledMetric(relativeTo: .body) private var maximumHeight: CGFloat = 180
    @State private var contentHeight: CGFloat = 180
    @ScaledMetric(relativeTo: .body) private var bodyScale = 1.0
    @ScaledMetric(relativeTo: .subheadline) private var supportingScale = 1.0

    init(node: XgentNode, document: XgentDocument, model: XgentPresentationModel, floatsAboveInput: Bool = false) {
        self.node = node; self.document = document; self.model = model
        self.floatsAboveInput = floatsAboveInput
        self._keyboard = ObservedObject(wrappedValue: model.composerKeyboard)
    }

    private var viewportHeight: CGFloat { min(max(contentHeight, 44), min(maximumHeight, 260)) }
    private var bodyFont: Font {
        #if os(iOS)
        let size = 17.0
        #else
        let size = theme.typography.body
        #endif
        return XgentFonts.body(theme.fontFamily, size: CGFloat(size * theme.fontScale) * bodyScale)
    }
    private var supportingFont: Font {
        #if os(iOS)
        let size = 15.0
        #else
        let size = theme.typography.supporting
        #endif
        return XgentFonts.body(theme.fontFamily, size: CGFloat(size * theme.fontScale) * supportingScale)
    }

    var body: some View {
        ScrollViewReader { proxy in
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let label = node.label {
                    Text(label).font(supportingFont.weight(.semibold)).foregroundStyle(.secondary)
                        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 4)
                        .accessibilityAddTraits(.isHeader)
                }
                ForEach(node.children ?? []) { child in
                    if child.action != nil {
                        Button { model.send(child, in: document) } label: {
                            HStack(alignment: .center, spacing: 12) {
                                if let icon = child.icon { Image(systemName: icon).frame(width: 24).accessibilityHidden(true) }
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(child.label ?? "").font(bodyFont).fixedSize(horizontal: false, vertical: true)
                                    if let text = child.text, !text.isEmpty {
                                        Text(text).font(supportingFont).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 4)
                            .background(keyboard.selectedID(menu: node, document: document) == child.id
                                ? Color(xgentHex: theme.palette(for: colorScheme).muted) : .clear,
                                in: RoundedRectangle(cornerRadius: 12))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).disabled(child.disabled == true || model.isBusy(child, in: document))
                        .accessibilityIdentifier(child.id)
                        .accessibilityAddTraits(keyboard.selectedID(menu: node, document: document) == child.id ? .isSelected : [])
                        .id(child.id)
                    } else {
                        Text(child.text ?? "").font(supportingFont).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true).padding(14)
                    }
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { _, height in
                if height.isFinite && height > 0 { contentHeight = height }
            }
          }
          .onChange(of: keyboard.selectedID(menu: node, document: document)) { _, id in
              if let id { proxy.scrollTo(id, anchor: .center) }
          }
        }
        .frame(height: viewportHeight)
        .modifier(XgentGlassSurface(radius: 22, floating: true))
        .offset(y: floatsAboveInput ? -(viewportHeight + 8) : 0)
        .accessibilityIdentifier(node.id)
    }
}
