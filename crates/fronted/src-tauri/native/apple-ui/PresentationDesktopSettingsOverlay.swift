#if os(macOS)
import SwiftUI

/// Desktop settings uses the same in-window dialog behavior as Windows/Linux.
struct XgentDesktopSettingsOverlay: View {
    let document: XgentDocument
    let availableSize: CGSize
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        let size = XgentDesktopSheetSizing.settingsSize(in: availableSize)
        let theme = document.theme ?? .fallback
        let shape = RoundedRectangle(cornerRadius: CGFloat(theme.radius.container), style: .continuous)
        let sidebar = document.nodes.first { $0.kind == .settingsLayout }?.children?.first
        let dismissLabel = sidebar?.children?.first { $0.id == "settings-close" }?.label ?? document.title
        ZStack {
            ZStack {
                Color.black.opacity(0.08).accessibilityHidden(true)
                XgentDesktopSettingsBackdrop(dialogSize: size,
                    cornerRadius: CGFloat(theme.radius.container),
                    label: dismissLabel,
                    enabled: document.dismissAction != nil) { model.dismiss(document) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            XgentSheetView(document: document, model: model)
                .frame(width: size.width, height: size.height)
                .clipShape(shape)
                .overlay { shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 1) }
                .shadow(color: .black.opacity(0.14), radius: 28, y: 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onExitCommand { model.dismiss(document) }
    }
}
#endif
