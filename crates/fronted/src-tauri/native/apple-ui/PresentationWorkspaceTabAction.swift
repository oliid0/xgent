import SwiftUI

struct XgentWorkspaceTabAction: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    var selected = false
    var dirty = false
    var closing = false
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .callout) private var scale = 1.0

    @MainActor static func send(_ action: XgentNode, document: XgentDocument, model: XgentPresentationModel) {
        model.codeHosts.commit(in: document)
        let source = XgentWorkspaceSourceDraft.current(for: action, in: document, model: model)?.encoded
        model.send(action, in: document, value: source.map(XgentValue.string) ?? .null)
    }

    var body: some View {
        Button { Self.send(node, document: document, model: model) } label: {
            HStack(spacing: 6) {
                if closing { Image(systemName: "xmark").accessibilityHidden(true) }
                else {
                    Text(node.label ?? "").lineLimit(1)
                    if dirty { Circle().fill(.tint).frame(width: 6, height: 6).accessibilityHidden(true) }
                }
            }
            .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * scale))
            .padding(.horizontal, closing ? 8 : 10)
            .frame(minWidth: closing ? 32 : 72, maxWidth: closing ? 44 : 240,
                   minHeight: document.formFactor == .mobile ? 44 : 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.label ?? "")
        .accessibilityAddTraits(selected && !closing ? [.isSelected] : [])
    }
}
