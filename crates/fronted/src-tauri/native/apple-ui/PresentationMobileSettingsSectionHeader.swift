#if os(iOS)
import SwiftUI
import UIKit

struct XgentIOSSettingsSectionHeader: View {
    let labels: [String]
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    var showsClose = false
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
            if showsClose {
                Spacer(minLength: 0)
                Button { model.dismiss(document) } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .modifier(XgentIOSNavigationControl())
                .accessibilityLabel(Text("Close"))
                .accessibilityIdentifier("presentation-sheet-close")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 16)
        .padding(.trailing, showsClose ? 0 : 16)
    }
}
#endif
