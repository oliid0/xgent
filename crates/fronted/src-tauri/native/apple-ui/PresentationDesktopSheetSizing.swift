#if os(macOS)
import SwiftUI

// GeometryReader-backed settings have no useful intrinsic size. Give the real
// presentation the same usable desktop space as its parent, retaining compact
// navigation for narrow windows instead of accepting a 300-point default sheet.
struct XgentDesktopSheetSizing: ViewModifier {
    let document: XgentDocument
    let availableSize: CGSize

    static func settingsSize(in available: CGSize) -> CGSize {
        let width = available.width.isFinite && available.width > 0 ? available.width : 1156
        let height = available.height.isFinite && available.height > 0 ? available.height : 700
        // 86.6% of each dimension occupies approximately 75% of the window.
        return CGSize(width: min(width * 0.866, max(1, width - 32)),
                      height: min(height * 0.866, max(1, height - 32)))
    }

    @ViewBuilder func body(content: Content) -> some View {
        if document.nodes.contains(where: { $0.kind == .settingsLayout }) {
            let size = Self.settingsSize(in: availableSize)
            content.frame(width: size.width, height: size.height).presentationSizing(.fitted)
        } else if document.nodes.contains(where: { $0.variant == "workspace-search-palette" }) {
            let size = Self.settingsSize(in: availableSize)
            content.frame(width: min(640, size.width), height: min(560, size.height)).presentationSizing(.fitted)
        } else {
            content
        }
    }
}
#endif
