#if os(macOS)
import SwiftUI

// A desktop sidebar control owns a real, full-height button. AppKit's generic
// menu label reports only its text cell, regardless of SwiftUI label padding.
struct XgentDesktopSoulMenu: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var showing = false
    @State private var contentHeight: CGFloat = 240
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var bodyScale = 1.0
    @ScaledMetric(relativeTo: .caption) private var captionScale = 1.0

    private var current: XgentNode {
        model.documents.first { $0.surface == document.surface }?.node(id: node.id) ?? node
    }

    var body: some View {
        Button { showing.toggle() } label: {
            HStack(spacing: 8) {
                Image(systemName: current.icon ?? "sparkles").accessibilityHidden(true)
                Text(current.label ?? "").lineLimit(1).truncationMode(.tail)
                    .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.down").font(.caption2).foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.body * theme.fontScale) * bodyScale, weight: .medium))
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(current.disabled == true)
        .accessibilityIdentifier(node.id)
        .accessibilityLabel(current.accessibilityLabel ?? current.label ?? "")
        .popover(isPresented: $showing, arrowEdge: .top) {
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(current.children ?? []) { item in
                        if item.kind == .divider { Divider().padding(.vertical, 6) }
                        else if item.kind == .settingsGroup || item.kind == .section {
                            if let label = item.label {
                                Text(label)
                                    .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale) * captionScale, weight: .semibold))
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.horizontal, 12).padding(.top, 8)
                                    .accessibilityAddTraits(.isHeader)
                            }
                            ForEach(item.children ?? []) { choice in choiceRow(choice) }
                        } else { choiceRow(item) }
                    }
                }.padding(8)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { _, height in
                        if height.isFinite && height > 0 { contentHeight = height }
                    }
            }
            .frame(width: 300)
            .frame(height: min(420, max(44, contentHeight)))
            .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.body * theme.fontScale) * bodyScale))
            .accessibilityElement(children: .contain)
        }
    }

    private func choiceRow(_ item: XgentNode) -> some View {
        Button {
            guard item.disabled != true, !model.isBusy(item, in: document) else { return }
            showing = false
            model.send(item, in: document)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: item.selected == true ? "checkmark" : item.icon ?? "sparkles")
                    .frame(width: 20).accessibilityHidden(true)
                Text(item.label ?? "").fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .background(item.selected == true ? Color(xgentHex: theme.palette(for: colorScheme).muted) : .clear,
                        in: RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.action == nil || item.disabled == true || model.isBusy(item, in: document))
        .accessibilityIdentifier(item.id)
        .accessibilityLabel(item.label ?? "")
        .accessibilityAddTraits(item.selected == true ? .isSelected : [])
    }
}
#endif
