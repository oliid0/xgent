import SwiftUI

struct XgentSidebarUpdateButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button { model.send(node, in: document) } label: {
            ZStack {
                if node.status == .running || model.isBusy(node, in: document) {
                    ProgressView().tint(.white).controlSize(.small)
                } else {
                    Image(systemName: node.icon ?? "arrow.down")
                        .font(.system(size: 18, weight: .semibold))
                }
            }
            .frame(width: 44, height: 44)
            .foregroundStyle(.white)
            .background(Color(xgentHex: theme.palette(for: scheme).accent), in: Circle())
            .contentShape(Circle())
            .accessibilityHidden(true)
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(node.label ?? "")
        .accessibilityValue(node.accessibilityValue ?? "")
        #if os(macOS)
        .help(node.label ?? "")
        #endif
    }
}
