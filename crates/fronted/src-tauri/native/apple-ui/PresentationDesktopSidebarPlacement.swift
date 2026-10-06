#if os(macOS)
import Foundation

struct XgentDesktopSidebarPlacement {
    let inline: Bool
    let preferredWidth: CGFloat
    let maximumWidth: CGFloat
    let columnWidth: CGFloat
    let drawerWidth: CGFloat
    let minimumMainWidth: CGFloat

    init(availableWidth: CGFloat, storedWidth: Double, sidebarVisible: Bool,
         panelVisible: Bool, panelExpanded: Bool) {
        let width = availableWidth.isFinite ? max(0, availableWidth) : 0
        preferredWidth = storedWidth.isFinite ? CGFloat(min(480, max(280, storedWidth))) : 360
        let reserve: CGFloat = 440 + 8 + (panelVisible ? 360 + 8 : 0)
        inline = sidebarVisible && !(panelVisible && panelExpanded) && width >= reserve + 280
        maximumWidth = min(480, max(280, width - reserve))
        columnWidth = inline ? min(preferredWidth, maximumWidth) : 0
        // A very narrow window uses its full content width. The title bar's
        // sidebar button remains available outside this drawer.
        drawerWidth = min(preferredWidth, width >= 304 ? width - 24 : width)
        minimumMainWidth = 440 + (inline ? columnWidth + 8 : 0)
    }

    func widthToRemember(_ measured: Double) -> Double? {
        guard inline, measured.isFinite, measured >= 280 else { return nil }
        // Remember user divider changes without treating a window-imposed
        // maximum as a new preferred width.
        if maximumWidth < preferredWidth, abs(CGFloat(measured) - maximumWidth) < 1 { return nil }
        return min(480, max(280, measured))
    }
}
#endif
