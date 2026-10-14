import SwiftUI

struct XgentGoalCheck: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    private var done: Bool { model.value(node, in: document).boolean }
    var body: some View {
        Button { model.send(node, in: document, value: .bool(!done), editing: true) } label: {
            HStack(spacing: 12) {
                Image(systemName: done ? "checkmark.square.fill" : "square")
                    .font(.system(size: 24))
                    .foregroundStyle(Color(xgentHex: done ? theme.palette(for: scheme).accent : theme.palette(for: scheme).secondaryText))
                    .frame(width: 44, height: 44).accessibilityHidden(true)
                if node.variant == "goal-step" {
                    Text(node.label ?? "").fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: node.variant == "goal-step" ? .infinity : nil, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .modifier(XgentControlTypography(node: node))
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityLabel(node.label ?? "")
        .accessibilityValue(node.text ?? "")
        .accessibilityIdentifier(node.id)
    }
}

struct XgentGoalRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .subheadline) private var detailScale = 1.0

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            if let check = node.children?.first(where: { $0.kind == .toggle }) {
                XgentGoalCheck(node: check, document: document, model: model)
            }
            if let open = node.children?.first(where: { $0.kind == .button }) {
                Button { model.send(open, in: document) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(open.label ?? "").fixedSize(horizontal: false, vertical: true)
                        if let text = open.text, !text.isEmpty {
                            Text(text).font(XgentFonts.body(theme.fontFamily,
                                size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale))
                                .foregroundStyle(Color(xgentHex: theme.palette(for: scheme).secondaryText))
                                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(open.disabled == true || model.isBusy(open, in: document))
                .accessibilityIdentifier(open.id)
            }
            if let menu = node.children?.first(where: { $0.kind == .menu }) {
                XgentNativeMenu(node: menu, document: document, model: model)
            }
        }
        .modifier(XgentControlTypography(node: node))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct XgentGoalActivityRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .subheadline) private var detailScale = 1.0

    private var open: XgentNode? { node.children?.first(where: { $0.kind == .button }) }
    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach((node.children ?? []).filter { $0.kind == .heading || $0.kind == .text }) { child in
                    Text(child.text ?? "")
                        .font(child.secondary == true ? XgentFonts.body(theme.fontFamily,
                            size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale) : nil)
                        .fontWeight(child.kind == .heading ? .semibold : .regular)
                        .foregroundStyle(child.secondary == true ? Color.secondary : Color.primary)
                        .lineLimit(child.id.hasSuffix(":preview") ? 2 : nil)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if open != nil { Image(systemName: "chevron.right").foregroundStyle(.secondary).accessibilityHidden(true) }
        }
        .frame(minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Circle().stroke(Color.secondary, lineWidth: 1.5)
                .overlay(Circle().fill(Color.secondary).padding(3))
                .frame(width: 12, height: 12)
                .padding(.top, 6).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                if let open = open {
                    Button { model.send(open, in: document) } label: { header }
                        .buttonStyle(.plain)
                        .disabled(open.disabled == true || model.isBusy(open, in: document))
                        .accessibilityIdentifier(open.id)
                } else { header }
                ForEach((node.children ?? []).filter { $0.kind == .codeBlock }) { child in
                    #if os(iOS)
                    XgentIOSNode(node: child, document: document, model: model)
                    #else
                    XgentNodeView(node: child, document: document, model: model)
                    #endif
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 16)
        .background(alignment: .leading) {
            Rectangle().fill(Color.secondary.opacity(0.2)).frame(width: 1)
                .padding(.leading, 5.5).padding(.top, 34)
        }
        .modifier(XgentControlTypography(node: node))
        .accessibilityElement(children: .contain)
    }
}

struct XgentGoalAssociationRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .subheadline) private var detailScale = 1.0

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: node.icon ?? "doc.text").font(.system(size: 24))
                .frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                ForEach((node.children ?? []).filter { $0.kind == .text }) { child in
                    Text(child.text ?? "")
                        .font(child.secondary == true ? XgentFonts.body(theme.fontFamily,
                            size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale) : nil)
                        .foregroundStyle(child.secondary == true ? Color.secondary : Color.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let menu = node.children?.first(where: { $0.kind == .menu }) {
                XgentNativeMenu(node: menu, document: document, model: model)
            }
        }
        .frame(minHeight: 70)
        .modifier(XgentControlTypography(node: node))
        .accessibilityElement(children: .contain)
    }
}

struct XgentGoalSection: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label = node.label, !label.isEmpty { HStack(spacing: 12) {
                if node.id == "goals-tracking" {
                    Circle().fill(Color.green).frame(width: 7, height: 7).accessibilityHidden(true)
                }
                Text(label).fontWeight(.semibold)
                    .foregroundStyle(node.id == "goals-tracking" ? Color.green : Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 16) }
            ForEach(Array((node.children ?? []).enumerated()), id: \.element.id) { index, child in
                if index > 0 && (child.variant == "goal-row" || child.variant == "goal-category" || child.variant == "goal-artifact" || child.variant == "goal-association") { Divider() }
                if child.variant == "goal-category" {
                    Button { model.send(child, in: document) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: child.icon ?? "circle").font(.system(size: 24))
                                .frame(width: 24).accessibilityHidden(true)
                            Text(child.label ?? "").fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                            Image(systemName: "plus").accessibilityHidden(true)
                        }
                        .frame(minHeight: 70).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(child.disabled == true || model.isBusy(child, in: document))
                    .accessibilityIdentifier(child.id)
                } else {
                    #if os(iOS)
                    XgentIOSNode(node: child, document: document, model: model)
                    #else
                    XgentNodeView(node: child, document: document, model: model)
                    #endif
                }
            }
        }
        .modifier(XgentControlTypography(node: node))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

struct XgentGoalFileRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @ScaledMetric(relativeTo: .subheadline) private var detailScale = 1.0

    var body: some View {
        Button { model.send(node, in: document) } label: {
            HStack(spacing: 12) {
                Image(systemName: "doc.text").font(.system(size: 24)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(node.label ?? "").fixedSize(horizontal: false, vertical: true)
                    if let detail = node.text, !detail.isEmpty { Text(detail).font(XgentFonts.body(theme.fontFamily,
                        size: CGFloat(theme.typography.supporting * theme.fontScale) * detailScale))
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                    if node.variant != "goal-artifacts-nav", let state = node.value?.text, !state.isEmpty {
                        Text(state).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if node.variant == "goal-artifacts-nav" {
                    Text(node.value?.text ?? "").foregroundStyle(.secondary)
                    Image(systemName: "chevron.right").accessibilityHidden(true)
                } else if node.status == "running" { ProgressView().accessibilityHidden(true) }
                else { Image(systemName: node.status == "completed" ? "checkmark" : "arrow.down.to.line").accessibilityHidden(true) }
            }
            .frame(minHeight: 70).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .modifier(XgentControlTypography(node: node))
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier(node.id)
        .accessibilityValue(node.value?.text ?? "")
    }
}
