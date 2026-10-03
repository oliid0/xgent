import Foundation
import SwiftUI

private struct XgentProviderRowHeights: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]
    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}

// Provider ordering is business state. Native drag/drop sends one complete
// permutation; move commands in each row's menu remain accessible without dragging.
struct XgentProviderListView: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var hovered: String?
    @State private var heights: [String: CGFloat] = [:]
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    private var rows: [XgentNode] {
        let children = node.children ?? []
        guard let data = model.value(node, in: document).text.data(using: .utf8),
              let order = try? JSONDecoder().decode([String].self, from: data) else { return children }
        let positions = Dictionary(order.enumerated().map { ($0.element, $0.offset) }, uniquingKeysWith: { first, _ in first })
        return children.sorted { (positions[$0.value?.text ?? ""] ?? Int.max) < (positions[$1.value?.text ?? ""] ?? Int.max) }
    }

    static func moving(_ source: String, to target: String, after: Bool, in ids: [String]) -> [String]? {
        guard source != target, ids.contains(source), ids.contains(target),
              Set(ids).count == ids.count else { return nil }
        var result = ids.filter { $0 != source }
        guard let destination = result.firstIndex(of: target) else { return nil }
        result.insert(source, at: destination + (after ? 1 : 0))
        return result
    }

    private func drop(_ items: [String], target: XgentNode, below: Bool) -> Bool {
        guard items.count == 1, node.disabled != true, !model.isBusy(node, in: document),
              let targetID = target.value?.text,
              let order = Self.moving(items[0], to: targetID, after: below,
                                      in: rows.compactMap { $0.value?.text }),
              let encoded = try? JSONEncoder().encode(order),
              let value = String(data: encoded, encoding: .utf8) else { return false }
        model.send(node, in: document, value: .string(value), editing: true)
        return true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider() }
                rowContent(row)
                    .padding(12)
                    .background {
                        GeometryReader { geometry in
                            Color.clear.preference(key: XgentProviderRowHeights.self, value: [row.id: geometry.size.height])
                        }
                    }
                    .background(hovered == row.id ? Color(xgentHex: theme.palette(for: colorScheme).accent).opacity(0.12) : .clear)
                    .dropDestination(for: String.self, action: { items, point in
                        // The lower half of a row inserts after it; this also
                        // permits moving a provider to the end of the list.
                        drop(items, target: row, below: point.y > (heights[row.id] ?? 56) / 2)
                    }, isTargeted: { targeted in hovered = targeted ? row.id : nil })
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onPreferenceChange(XgentProviderRowHeights.self) { heights = $0 }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private func rowContent(_ row: XgentNode) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if rows.count > 1, let id = row.value?.text {
                Image(systemName: "line.3.horizontal")
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 44)
                    .contentShape(Rectangle())
                    .draggable(id)
                    .accessibilityLabel(node.label ?? "")
                    .accessibilityIdentifier("provider-drag:" + id)
            }
            if let title = row.children?.first(where: { $0.kind == .navigationRow }) {
                Button { model.send(title, in: document) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title.label ?? "").modifier(XgentControlTypography(node: title))
                            .fontWeight(.medium).fixedSize(horizontal: false, vertical: true)
                        if let description = title.text, !description.isEmpty {
                            Text(description).font(.subheadline).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        ForEach((row.children ?? []).filter { $0.kind != .navigationRow && $0.kind != .menu }) { child in
                            XgentNodeView(node: child, document: document, model: model)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(title.disabled == true || model.isBusy(title, in: document))
                .accessibilityIdentifier(title.id)
            }
            if let actions = row.children?.first(where: { $0.kind == .menu }) {
                XgentNativeMenu(node: actions, document: document, model: model)
                    .accessibilityIdentifier(actions.id)
            }
        }
        .accessibilityElement(children: .contain)
    }
}
