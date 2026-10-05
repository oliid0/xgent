#if os(iOS)
import SwiftUI

struct XgentSidebarSettingsButton: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var soulOpen = false

    private var menu: XgentNode? { node.children?.first { $0.id == "sidebar-soul-menu" } }
    private var height: CGFloat {
        let count = (menu?.children?.first { $0.id == "sidebar-soul-presets" }?.children?.count ?? 0) + 1
        return CGFloat(min(560, 104 + count * 52))
    }

    var body: some View {
        Button {
            // A completed long press opens Soul. Its release must not also
            // navigate to Settings and remove the sheet's sidebar owner.
            guard !soulOpen else { return }
            model.send(node, in: document)
        } label: {
            Image(systemName: node.icon ?? "gearshape")
                .accessibilityHidden(true)
                .font(.system(size: 18, weight: .medium))
                .frame(width: 44, height: 44)
                .background(Color(xgentHex: theme.palette(for: scheme).surface), in: Circle())
                .overlay(Circle().stroke(Color(xgentHex: theme.palette(for: scheme).border), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true)
        .accessibilityLabel(node.label ?? "")
        .accessibilityIdentifier(node.id)
        .accessibilityAction(named: Text(menu?.label ?? "")) {
            if menu != nil { soulOpen = true }
        }
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.52, maximumDistance: 10).onEnded { _ in
            if menu != nil { soulOpen = true }
        })
        .sheet(isPresented: $soulOpen) {
            if let menu {
                XgentSidebarSoulPicker(menu: menu, document: document, model: model) { soulOpen = false }
                    .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(height), .large])
                    .presentationDragIndicator(.hidden)
                    .presentationCornerRadius(28)
                    .presentationBackground(.regularMaterial)
            }
        }
    }
}
#endif
