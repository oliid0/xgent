import SwiftUI

/// Match Astryx ChatToolCalls: a compact call or the latest call in a group,
/// with complete evidence available through an independent disclosure.
struct XgentTranscriptToolCall: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var expanded = false
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .caption) private var detailScale = 1.0

    private var grouped: Bool {
        let children = node.children ?? []
        return children.count > 1 && children.allSatisfy { $0.kind == .toolCall }
    }

    private var headerNode: XgentNode {
        grouped && !expanded ? node.children?.last ?? node : node
    }

    @ViewBuilder private var label: some View {
        HStack(alignment: .top, spacing: 8) {
            XgentToolCallHeader(node: headerNode, statusOverride: grouped ? node.status : nil)
            if grouped && !expanded, let count = node.text {
                Text(count)
                    .font(XgentFonts.body(theme.fontFamily,
                        size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale))
                    .foregroundStyle(Color(xgentHex: theme.palette(for: scheme).secondaryText))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        Group {
            if node.children?.isEmpty == false {
                DisclosureGroup(isExpanded: $expanded) {
                    VStack(alignment: .leading, spacing: 8) {
                        #if os(iOS)
                        XgentIOSNodes(nodes: node.children ?? [], document: document, model: model)
                        #else
                        XgentNodeChildren(nodes: node.children ?? [], document: document, model: model)
                        #endif
                    }
                    .padding(.top, 6)
                } label: { label }
                .disclosureGroupStyle(XgentTranscriptDisclosureStyle(id: node.id))
            } else { label }
        }
        .tint(Color(xgentHex: theme.palette(for: scheme).secondaryText))
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(node.id)
    }
}

// The whole summary opens the evidence. Desktop rows stay compact while
// touch controls retain a 44-point activation area, including the caret.
private struct XgentTranscriptDisclosureStyle: DisclosureGroupStyle {
    let id: String

    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { configuration.isExpanded.toggle() } label: {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: configuration.isExpanded ? "chevron.down" : "chevron.forward")
                        .font(.caption.weight(.semibold))
                        .padding(.top, 3)
                        .accessibilityHidden(true)
                    configuration.label
                }
                .frame(maxWidth: .infinity, minHeight: minimumHeight, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("\(id):disclosure")
            if configuration.isExpanded { configuration.content }
        }
    }

    private var minimumHeight: CGFloat {
        #if os(iOS)
        44
        #else
        24
        #endif
    }
}
