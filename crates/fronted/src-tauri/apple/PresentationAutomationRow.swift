import Flow
import SwiftUI

struct XgentAutomationRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    private var items: [XgentNode] { node.children ?? [] }
    private var metadata: [XgentNode] { items.filter { $0.kind == .badge } }
    private var actions: [XgentNode] { items.filter { $0.kind == .iconButton || $0.kind == .button || $0.kind == .menu || $0.kind == .toggle } }
    private var content: [XgentNode] {
        items.filter { $0.kind != .badge && $0.kind != .iconButton && $0.kind != .button && $0.kind != .menu && $0.kind != .toggle }
    }
    private var viewAction: XgentNode? {
        actions.flatMap { $0.children ?? [] }.first { $0.id == "\(node.id):view" }
    }

    @ViewBuilder private func render(_ item: XgentNode) -> some View {
        if item.kind == .toggle {
            Toggle(item.label ?? "", isOn: Binding(
                get: { model.value(item, in: document).boolean },
                set: { model.send(item, in: document, value: .bool($0), editing: true) }
            ))
            .toggleStyle(.switch).labelsHidden()
            .disabled(item.disabled == true || model.isBusy(item, in: document))
            .accessibilityLabel(item.label ?? "")
        } else {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: node.icon ?? "calendar.badge.clock")
                    .font(.system(size: 24))
                    .foregroundStyle(.secondary)
                    .frame(width: 40, height: 40)
                    .background(Color(xgentHex: theme.palette(for: scheme).surface),
                                in: RoundedRectangle(cornerRadius: 11))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Button {
                        if let action = viewAction { model.send(action, in: document) }
                    } label: {
                        Text(node.label ?? "").fontWeight(.semibold).lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .disabled(viewAction == nil)
                    HFlow(itemSpacing: 8, rowSpacing: 4) {
                        ForEach(metadata) { item in
                            Text(item.label ?? "").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                HFlow(itemSpacing: 4, rowSpacing: 4) {
                    ForEach(actions) { render($0) }
                }
            }
            ForEach(content) { render($0) }
        }
        .modifier(XgentControlTypography(node: node))
        .padding(CGFloat(theme.spacing.md))
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Divider().allowsHitTesting(false) }
        .accessibilityElement(children: .contain)
    }
}

struct XgentTaskReviewGroup: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    private var headerActions: [XgentNode] {
        (node.children ?? []).filter { $0.kind == .iconButton || $0.kind == .menu }
    }
    private var content: [XgentNode] {
        (node.children ?? []).filter { $0.kind != .iconButton && $0.kind != .menu }
    }
    @ViewBuilder private func render(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }
    var body: some View {
        VStack(alignment: .leading, spacing: CGFloat(theme.spacing.sm)) {
            HStack(spacing: 8) {
                Text(node.label ?? "").font(.headline).lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                ForEach(headerActions) { render($0) }
            }
            ForEach(content) { render($0) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

struct XgentConnectorCatalog: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ViewBuilder private func render(_ item: XgentNode) -> some View {
        if item.id == "connector-search" {
            XgentSettingsSearchField(node: item, document: document, model: model)
        } else {
            #if os(iOS)
            XgentIOSNode(node: item, document: document, model: model)
            #else
            XgentNodeView(node: item, document: document, model: model)
                .environment(\.xgentSettingsRow, true)
            #endif
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(node.label ?? "").font(.headline).accessibilityAddTraits(.isHeader)
            ForEach(Array((node.children ?? []).enumerated()), id: \.element.id) { index, item in
                if index > 2 { Divider() }
                render(item)
            }
        }
        .padding(CGFloat(theme.spacing.lg))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: theme.palette(for: scheme).card),
                    in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.container)))
        .accessibilityElement(children: .contain)
    }
}
