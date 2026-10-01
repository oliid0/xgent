import Foundation

struct XgentWorkspacePanelControls: Decodable {
    let focusRequest: Int
    let openLabel: String
    let returnLabel: String
    let expandLabel: String
    let restoreLabel: String
    let closeLabel: String

    var isValid: Bool {
        (0...9_007_199_254_740_991).contains(focusRequest) &&
        [openLabel, returnLabel, expandLabel, restoreLabel, closeLabel].allSatisfy {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}

struct XgentWorkspacePanelIdentity: Equatable {
    let surface: String
    let focusRequest: Int
}

/// Selection and sizing are presentation state; sessions remain owned by the shared controllers.
struct XgentWorkspacePanelState {
    private(set) var selectedSurface: String?
    private var known: [String: Int] = [:]
    private var order: [String] = []
    var visible = true
    var expanded = false

    mutating func synchronize(_ panels: [XgentWorkspacePanelIdentity]) {
        let requested = panels.last { known[$0.surface] != $0.focusRequest }
        known = Dictionary(uniqueKeysWithValues: panels.map { ($0.surface, $0.focusRequest) })
        if let requested {
            selectedSurface = requested.surface
            visible = true
        } else if !panels.contains(where: { $0.surface == selectedSurface }) {
            let available = Set(panels.map(\.surface))
            if let selectedSurface, let index = order.firstIndex(of: selectedSurface) {
                self.selectedSurface = order.dropFirst(index + 1).first { available.contains($0) } ??
                    order.prefix(index).reversed().first { available.contains($0) } ?? panels.first?.surface
            } else { selectedSurface = panels.first?.surface }
        }
        order = panels.map(\.surface)
        if panels.isEmpty { expanded = false }
    }

    mutating func select(_ surface: String) {
        guard known[surface] != nil else { return }
        selectedSurface = surface
        visible = true
    }

    static func canSplit(width: CGFloat, minimumMainWidth: CGFloat) -> Bool {
        width.isFinite && width >= minimumMainWidth + 360 + 8
    }

    static func panelWidth(_ stored: Double, available: CGFloat, minimumMainWidth: CGFloat) -> CGFloat {
        let proposed = stored.isFinite ? CGFloat(stored) : 420
        return min(max(360, proposed), max(360, available - minimumMainWidth - 8))
    }
}
