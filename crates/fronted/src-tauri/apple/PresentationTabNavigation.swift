import SwiftUI

/// The same wraparound/Home/End rule as the shared desktop tabState.ts.
enum XgentTabNavigation {
    static func destination(ids: [String], current: String, key: KeyEquivalent, rtl: Bool) -> String? {
        guard let index = ids.firstIndex(of: current), !ids.isEmpty else { return nil }
        if key == .home { return ids.first }
        if key == .end { return ids.last }
        let direction = key == .rightArrow ? 1 : key == .leftArrow ? -1 : 0
        guard direction != 0 else { return nil }
        return ids[(index + direction * (rtl ? -1 : 1) + ids.count) % ids.count]
    }
}

struct XgentTabKeyNavigation: ViewModifier {
    let ids: [String]
    let current: String?
    let select: (String) -> Bool
    let close: () -> Bool
    @Environment(\.layoutDirection) private var direction

    func body(content: Content) -> some View {
        content.onKeyPress(keys: [.leftArrow, .rightArrow, .home, .end, .delete, .deleteForward]) { press in
            guard press.modifiers.intersection([.command, .control, .option, .shift]).isEmpty,
                  let current else { return .ignored }
            if press.key == .delete || press.key == .deleteForward { return close() ? .handled : .ignored }
            guard let target = XgentTabNavigation.destination(ids: ids, current: current,
                key: press.key, rtl: direction == .rightToLeft) else { return .ignored }
            return select(target) ? .handled : .ignored
        }
    }
}
