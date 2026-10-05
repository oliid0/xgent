#if os(iOS)
import SwiftUI
import UIKit

struct XgentIOSSettingsSectionHeader: View {
    let labels: [String]
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .subheadline) private var fontSize: CGFloat = 15

    var body: some View {
        HStack(spacing: 12) {
            if !labels.isEmpty {
                Text(labels.joined(separator: " / "))
                    .font(XgentFonts.body(theme.fontFamily, size: fontSize * CGFloat(theme.fontScale), weight: .semibold))
                    .foregroundStyle(Color(uiColor: .secondaryLabel))
                    .fixedSize(horizontal: false, vertical: true)
                    .textCase(nil)
                    .accessibilityAddTraits(.isHeader)
                    .layoutPriority(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 16)
        .padding(.trailing, 16)
    }
}
#endif
