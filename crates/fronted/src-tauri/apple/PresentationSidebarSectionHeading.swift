import SwiftUI

struct XgentSidebarSectionHeading: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .subheadline) private var scale = 1.0

    private var controlSize: CGFloat {
        #if os(iOS)
        44
        #else
        32
        #endif
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(node.text ?? node.label ?? "")
                .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * scale, weight: .semibold))
                .foregroundStyle(Color(xgentHex: theme.palette(for: scheme).secondaryText))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            ForEach(node.children ?? []) { action in
                if action.kind == .menu {
                    XgentNativeMenu(node: action, document: document, model: model)
                } else if action.kind == .iconButton {
                    Button { model.send(action, in: document) } label: {
                        Image(systemName: action.icon ?? "plus")
                            .frame(width: controlSize, height: controlSize)
                    }
                    .buttonStyle(.plain)
                    .disabled(action.disabled == true || model.isBusy(action, in: document))
                    .accessibilityIdentifier(action.id)
                    .accessibilityLabel(action.accessibilityLabel ?? action.label ?? "")
                    .help(action.label ?? "")
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: controlSize, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
