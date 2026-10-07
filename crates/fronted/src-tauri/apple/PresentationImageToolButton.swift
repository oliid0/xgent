import SwiftUI

struct XgentImageToolButton: View {
    let label: String
    let icon: String
    let id: String
    var disabled = false
    var busy = false
    let action: () -> Void
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize
    private var dimension: CGFloat {
        #if os(iOS)
        return 44
        #else
        return typeSize.isAccessibilitySize ? 44 : 32
        #endif
    }

    var body: some View {
        Button(action: action) {
            Group {
                if busy { ProgressView().controlSize(.small) }
                else { Image(systemName: icon).accessibilityHidden(true) }
            }
            .frame(minWidth: dimension, minHeight: dimension)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color(xgentHex: theme.palette(for: scheme).text))
        .disabled(disabled || busy)
        .accessibilityIdentifier(id)
        .accessibilityLabel(label)
        .help(label)
    }
}
