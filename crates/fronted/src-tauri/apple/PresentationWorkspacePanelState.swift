import Foundation

struct XgentWorkspacePanelControls: Decodable {
    let focusRequest: Int
    let expandRequest: Int?
    let openLabel: String
    let returnLabel: String
    let expandLabel: String
    let restoreLabel: String
    let closeLabel: String
    let closeTabLabel: String?
    let dockLabel: String?
    let undockLabel: String?

    var isValid: Bool {
        (0...9_007_199_254_740_991).contains(focusRequest) &&
        (expandRequest.map { (0...9_007_199_254_740_991).contains($0) } ?? true) &&
        ((dockLabel == nil && undockLabel == nil) ||
         [dockLabel, undockLabel].allSatisfy { $0.map { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? false }) &&
        (closeTabLabel.map { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? true) &&
        [openLabel, returnLabel, expandLabel, restoreLabel, closeLabel].allSatisfy {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}

struct XgentWorkspacePanelIdentity: Equatable {
    let surface: String
    let focusRequest: Int
    var expandRequest: Int = 0
}

/// Selection and sizing are presentation state; sessions remain owned by the shared controllers.
struct XgentWorkspacePanelState {
    private(set) var selectedSurface: String?
    private(set) var dockedSurface: String?
    private var known: [String: Int] = [:]
    private var knownExpansions: [String: Int] = [:]
    private var order: [String] = []
    var visible = true
    var expanded = false

    mutating func synchronize(_ panels: [XgentWorkspacePanelIdentity]) {
        let requested = panels.last { known[$0.surface] != $0.focusRequest }
        let previousExpansions = knownExpansions
        knownExpansions = Dictionary(uniqueKeysWithValues: panels.map {
            ($0.surface, max(previousExpansions[$0.surface] ?? 0, $0.expandRequest))
        })
        known = Dictionary(uniqueKeysWithValues: panels.map { ($0.surface, $0.focusRequest) })
        if let dockedSurface, !panels.contains(where: { $0.surface == dockedSurface }) {
            self.dockedSurface = nil
        }
        if let requested, requested.surface != dockedSurface {
            selectedSurface = requested.surface
            visible = true
        } else if !panels.contains(where: { $0.surface == selectedSurface && $0.surface != dockedSurface }) {
            let available = Set(panels.filter { $0.surface != dockedSurface }.map(\.surface))
            if let selectedSurface, let index = order.firstIndex(of: selectedSurface) {
                self.selectedSurface = order.dropFirst(index + 1).first { available.contains($0) } ??
                    order.prefix(index).reversed().first { available.contains($0) } ?? panels.first { $0.surface != dockedSurface }?.surface
            } else { selectedSurface = panels.first { $0.surface != dockedSurface }?.surface }
        }
        order = panels.map(\.surface)
        if visible, let selected = panels.first(where: { $0.surface == selectedSurface && $0.surface != dockedSurface }),
           let previous = previousExpansions[selected.surface], selected.expandRequest > previous,
           (selected.expandRequest - previous) % 2 == 1 {
            expanded.toggle()
        }
        if panels.isEmpty { expanded = false }
    }

    mutating func select(_ surface: String) {
        guard known[surface] != nil, surface != dockedSurface else { return }
        selectedSurface = surface
        visible = true
    }

    mutating func dock(_ surface: String) {
        guard known[surface] != nil else { return }
        dockedSurface = surface
        if selectedSurface == surface { selectedSurface = order.last { $0 != surface } }
        visible = true
        expanded = false
    }

    mutating func hideDock() { dockedSurface = nil }

    mutating func restoreDock() {
        guard let surface = dockedSurface else { return }
        dockedSurface = nil
        select(surface)
    }

    static func canSplit(width: CGFloat, minimumMainWidth: CGFloat) -> Bool {
        width.isFinite && width >= minimumMainWidth + 360 + 8
    }

    static func panelWidth(_ stored: Double, available: CGFloat, minimumMainWidth: CGFloat) -> CGFloat {
        let proposed = stored.isFinite ? CGFloat(stored) : 420
        return min(max(360, proposed), max(360, available - minimumMainWidth - 8))
    }
}
