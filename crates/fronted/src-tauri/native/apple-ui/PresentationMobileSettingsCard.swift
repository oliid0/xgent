#if os(iOS)
import SwiftUI
import UIKit

private struct XgentSettingsFieldHeaderKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var xgentSettingsFieldHeader: Bool {
        get { self[XgentSettingsFieldHeaderKey.self] }
        set { self[XgentSettingsFieldHeaderKey.self] = newValue }
    }
}

struct XgentIOSSettingsCard: View {
    let section: XgentSettingsFormSection
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .subheadline) private var labelSize: CGFloat = 15

    private var field: XgentNode? {
        guard section.controlRows.count == 1, let row = section.controlRows.first,
              row.kind == .textInput, row.label?.isEmpty == false else { return nil }
        return row
    }

    var body: some View {
        if section.controlRows.count == 1,
           let area = section.controlRows.first, area.variant == "other-settings-area" {
            // Each area contains its own cards and explanations. Adding another
            // card here would double the inset and squeeze the actual controls.
            XgentIOSNode(node: area, document: document, model: model, parentAxis: .vertical)
        } else {
          VStack(alignment: .leading, spacing: 10) {
            if let field, !section.labels.contains(field.label ?? "") {
                Text(field.label ?? "")
                    .font(XgentFonts.body(theme.fontFamily, size: labelSize * CGFloat(theme.fontScale), weight: .semibold))
                    .foregroundStyle(Color(uiColor: .secondaryLabel))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
            }
            VStack(spacing: 0) {
                ForEach(section.controlRows) { row in
                    XgentIOSNode(node: row, document: document, model: model, parentAxis: .vertical)
                        .environment(\.xgentSettingsFieldHeader, field != nil)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 16).padding(.vertical, 5)
                    if section.hasControls, row.id != section.controlRows.last?.id {
                        Divider().padding(.leading, row.icon == nil ? 16 : 50).padding(.trailing, 16)
                            .accessibilityHidden(true)
                    }
                }
            }
            .background(section.hasControls ? Color(xgentHex: theme.palette(for: colorScheme).card) : .clear,
                in: RoundedRectangle(cornerRadius: 26, style: .continuous))
          }
        }
    }
}
#endif
