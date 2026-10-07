import SwiftUI

// The shared editor selects Monaco's `vs`/`vs-dark` defaults. Keep these
// manually authored native colors aligned with pinned Monaco 0.56's registry.
struct XgentCodeFindPaintStyle: Equatable {
    let match: String
    let scope: String
    let current: String
    init(_ scheme: ColorScheme) {
        match = "#EA5C0055"
        scope = scheme == .dark ? "#3A3D4166" : "#B4B4B44D"
        current = scheme == .dark ? "#515C6A" : "#A8AC94"
    }
}
