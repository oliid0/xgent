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
        ZStack {
            Button { model.dismiss(document) } label: {
                Color.black.opacity(0.08).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(document.dismissAction == nil)
            .accessibilityLabel(Text("Close settings"))
            .accessibilityIdentifier("settings-dismiss-backdrop")
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
