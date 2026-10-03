#if os(macOS)
import SwiftUI

/// The sidebar panel has independent list and diff scrollports. Narrow panels
/// navigate between them; expanded panels keep both visible with a resize divider.
struct XgentDesktopGitLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var detailVisible = false

    private var toolbar: XgentNode? { document.node(id: "desktop-git-toolbar") }
    private var list: XgentNode? { document.node(id: "desktop-git-list") }
    private var detail: XgentNode? { document.node(id: "desktop-git-detail") }
    private var commit: XgentNode? { document.node(id: "desktop-git-commit") }
    private var selection: String {
        let prefix = document.node(id: "git-view")?.value?.text == "history" ? "git-commit:" : "git-working:"
        return (list?.children ?? []).flatMap { $0.children ?? [] }
            .first { $0.id.hasPrefix(prefix) && $0.selected == true }?.id
            ?? document.node(id: "git-diff-title")?.text ?? ""
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                if let toolbar {
                    ScrollView { XgentNodeView(node: toolbar, document: document, model: model) }
                        .frame(maxHeight: min(240, geometry.size.height * 0.38))
                }
                Divider()
                if geometry.size.width >= 620 {
                    HSplitView {
                        pane(list).frame(minWidth: 200, idealWidth: 280, maxWidth: geometry.size.width * 0.6)
                        pane(detail).frame(minWidth: 240, maxWidth: .infinity)
                    }
                    .accessibilityIdentifier("xgent-git-split")
                } else {
                    HStack {
                        Button(list?.label ?? "") { detailVisible = false }
                            .accessibilityIdentifier("xgent-git-show-list")
                        Button(detail?.label ?? "") { detailVisible = true }
                            .accessibilityIdentifier("xgent-git-show-detail")
                    }
                    .buttonStyle(.bordered)
                    .padding(8)
                    pane(detailVisible ? detail : list)
                }
                if let commit, commit.children?.isEmpty == false {
                    Divider()
                    XgentNodeView(node: commit, document: document, model: model)
                        .padding(12)
                        .onSubmit {
                            if let submit = document.node(id: "git-commit") { model.send(submit, in: document) }
                        }
                }
            }
        }
        .onChange(of: selection) { _, value in if !value.isEmpty { detailVisible = true } }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("xgent-desktop-git")
    }

    private func pane(_ node: XgentNode?) -> some View {
        ScrollView {
            if let node {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(node.children ?? []) { child in
                        if child.id.hasPrefix("git-commit:") || child.id.hasPrefix("git-history-marker:") {
                            HStack(alignment: .top, spacing: 8) {
                                if let graph = XgentGitGraphRow.decode(child.value?.text) {
                                    XgentGitGraphCell(row: graph)
                                        .frame(width: CGFloat(graph.columns + 1) * 11)
                                        .frame(maxHeight: .infinity)
                                }
                                XgentNodeView(node: child, document: document, model: model)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        } else {
                            XgentNodeView(node: child, document: document, model: model)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier(node?.id ?? "xgent-git-empty-pane")
    }
}

struct XgentGitGraphRow: Decodable {
    struct Lane: Decodable { let id: String; let color: XgentValue }
    let kind: String
    let sha: String
    let parents: [String]
    let commitCol: Int
    let commitColor: XgentValue
    let inputLanes: [Lane]
    let outputLanes: [Lane]
    let isHead: Bool
    let isMerge: Bool
    var columns: Int { max(max(inputLanes.count, outputLanes.count), max(commitCol + 1, 1)) }

    static func decode(_ value: String?) -> Self? {
        guard let bytes = value?.data(using: .utf8), let row = try? JSONDecoder().decode(Self.self, from: bytes),
              row.commitCol >= 0, row.commitCol < 64, row.columns <= 64 else { return nil }
        return row
    }
}

/// Draw the same shared lane topology without embedding the web SVG renderer.
private struct XgentGitGraphCell: View {
    let row: XgentGitGraphRow
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    private let colors = ["#ffb000", "#dc267f", "#994f00", "#40b0a6", "#b66dff"]

    private func color(_ value: XgentValue) -> Color {
        switch value {
        case .number(let index): return Color(xgentHex: colors[Int(abs(index.truncatingRemainder(dividingBy: Double(colors.count))))])
        case .string(let text):
            if text.contains("-local)") { return Color(xgentHex: theme.palette(for: scheme).accent) }
            if text.contains("-remote)") { return .blue }
            if text.contains("-base)") { return .secondary }
            return Color(xgentHex: text)
        default: return .secondary
        }
    }

    var body: some View {
        Canvas { context, size in
            let middle: CGFloat = 20
            let center = CGFloat(row.commitCol + 1) * 11
            for (index, lane) in row.inputLanes.enumerated() {
                let x = CGFloat(index + 1) * 11
                var path = Path()
                path.move(to: CGPoint(x: x, y: 0))
                if lane.id == row.sha {
                    path.addCurve(to: CGPoint(x: center, y: middle),
                                  control1: CGPoint(x: x, y: middle * 0.5), control2: CGPoint(x: center, y: middle * 0.5))
                } else if let output = row.outputLanes.firstIndex(where: { $0.id == lane.id }) {
                    let target = CGFloat(output + 1) * 11
                    path.addCurve(to: CGPoint(x: target, y: middle * 2),
                                  control1: CGPoint(x: x, y: middle), control2: CGPoint(x: target, y: middle))
                    path.addLine(to: CGPoint(x: target, y: size.height))
                }
                context.stroke(path, with: .color(color(lane.color)), lineWidth: 1.5)
            }
            for parent in row.parents {
                guard let index = row.outputLanes.firstIndex(where: { $0.id == parent }) else { continue }
                let target = CGFloat(index + 1) * 11
                var path = Path()
                path.move(to: CGPoint(x: center, y: middle))
                path.addCurve(to: CGPoint(x: target, y: middle * 2),
                              control1: CGPoint(x: center, y: middle * 1.5), control2: CGPoint(x: target, y: middle * 1.5))
                path.addLine(to: CGPoint(x: target, y: size.height))
                context.stroke(path, with: .color(color(row.outputLanes[index].color)), lineWidth: 1.5)
            }
            let radius: CGFloat = row.isHead || row.isMerge ? 5 : 4
            let dot = Path(ellipseIn: CGRect(x: center - radius, y: middle - radius, width: radius * 2, height: radius * 2))
            let markerColor = color(row.commitColor)
            context.fill(dot, with: .color(markerColor))
            if row.isMerge || row.kind != "commit" {
                let inner = Path(ellipseIn: CGRect(x: center - 2, y: middle - 2, width: 4, height: 4))
                context.fill(inner, with: .color(Color(xgentHex: theme.palette(for: scheme).background)))
            }
        }
        .frame(minHeight: 44)
        .accessibilityHidden(true)
    }
}
#endif
