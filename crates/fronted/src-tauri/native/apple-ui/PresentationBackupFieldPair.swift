import SwiftUI

struct XgentBackupFieldPair<First: View, Second: View>: View {
    let mobile: Bool
    let first: First
    let second: Second
    @Environment(\.dynamicTypeSize) private var textSize

    init(mobile: Bool, @ViewBuilder first: () -> First, @ViewBuilder second: () -> Second) {
        self.mobile = mobile
        self.first = first()
        self.second = second()
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 16) { first; second }
    }

    var body: some View {
        if mobile || textSize.isAccessibilitySize {
            vertical
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    first.frame(minWidth: 220, maxWidth: .infinity)
                    second.frame(minWidth: 220, maxWidth: .infinity)
                }
                vertical
            }
        }
    }
}
