import SwiftUI

struct XgentDiffRow {
    enum Kind: Equatable { case header, context, addition, deletion }

    let index: Int
    let text: String
    let oldLine: Int?
    let newLine: Int?
    let kind: Kind

    static func parse(_ source: String) -> [Self] {
        var oldLine: Int?
        var newLine: Int?
        return source.components(separatedBy: "\n").enumerated().map { index, text in
            let row: Self
            if text.hasPrefix("@@ ") {
                let fields = text.split(separator: " ", maxSplits: 3)
                oldLine = nil
                newLine = nil
                if fields.count >= 3 {
                    oldLine = fields[1].dropFirst().split(separator: ",", maxSplits: 1).first.flatMap { Int($0) }
                    newLine = fields[2].dropFirst().split(separator: ",", maxSplits: 1).first.flatMap { Int($0) }
                }
                row = Self(index: index, text: text, oldLine: nil, newLine: nil, kind: .header)
            } else if text.hasPrefix("+++") || text.hasPrefix("---") || text.hasPrefix("diff ")
                        || text.hasPrefix("index ") || text.hasPrefix("\\") {
                row = Self(index: index, text: text, oldLine: nil, newLine: nil, kind: .header)
            } else if text.hasPrefix("+") {
                row = Self(index: index, text: text, oldLine: nil, newLine: newLine, kind: .addition)
                newLine = newLine.map { $0 + 1 }
            } else if text.hasPrefix("-") {
                row = Self(index: index, text: text, oldLine: oldLine, newLine: nil, kind: .deletion)
                oldLine = oldLine.map { $0 + 1 }
            } else if text.hasPrefix(" ") {
                row = Self(index: index, text: text, oldLine: oldLine, newLine: newLine, kind: .context)
                oldLine = oldLine.map { $0 + 1 }
                newLine = newLine.map { $0 + 1 }
            } else {
                row = Self(index: index, text: text, oldLine: nil, newLine: nil, kind: .header)
            }
            return row
        }
    }
}

// Tool evidence and Markdown fences use the same scrolling/copy surface.
struct XgentCodeBlock: View {
    let text: String
    var language: String?
    var label: String?
    var configuration = XgentCodeBlockConfiguration.plain
    var retainedState: XgentCodeBlockState? = nil
    var highlightCode: ((String, String) async -> String?)? = nil
    @StateObject private var localState = XgentCodeBlockState()

    var body: some View {
        XgentCodeBlockSurface(text: text, language: language, label: label, configuration: configuration,
                              state: retainedState ?? localState, highlightCode: highlightCode)
    }
}

private struct XgentCodeBlockSurface: View {
    let text: String
    let language: String?
    let label: String?
    let configuration: XgentCodeBlockConfiguration
    @ObservedObject var state: XgentCodeBlockState
    let highlightCode: ((String, String) async -> String?)?
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.xgentCodeBlockViewportHeight) private var viewportHeight
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 13
    @State private var viewportWidth: CGFloat = 0

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var metrics: XgentCodeBlockMetrics { .init(source: text) }
    private var title: String? {
        let languageLabel = configuration.hasLanguageLabel && language != "plaintext" ? language : nil
        if let label, let languageLabel { return "\(label) · \(languageLabel)" }
        return label ?? languageLabel
    }
    private var canCollapse: Bool { metrics.canCollapse(configuration, hasHeader: title != nil) }
    private var maximumHeight: CGFloat? {
        XgentCodeBlockMetrics.heightLimit(configuration, viewportHeight: Double(viewportHeight)).map { CGFloat($0) }
    }
    private var codeFont: Font { XgentFonts.code(theme.codeFontFamily, size: fontSize * CGFloat(theme.fontScale)) }
    private var backgroundColor: String {
        configuration.syntaxBackground.map { colorScheme == .dark ? $0.dark : $0.light } ?? palette.muted
    }
    private var headerColor: String? {
        configuration.syntaxComment.map { colorScheme == .dark ? $0.dark : $0.light }
    }
    private var gutterWidth: CGFloat { 28 * fontSize * CGFloat(theme.fontScale) / 13 }

    private func diffForeground(_ row: XgentDiffRow) -> Color {
        switch row.kind {
        case .addition:
            return colorScheme == .dark ? .green : Color(red: 0.12, green: 0.42, blue: 0.18)
        case .deletion:
            return colorScheme == .dark ? .red : Color(red: 0.65, green: 0.13, blue: 0.13)
        case .header:
            return Color(xgentHex: palette.secondaryText)
        case .context:
            return Color(xgentHex: palette.text)
        }
    }

    private func diffBackground(_ row: XgentDiffRow) -> Color {
        switch row.kind {
        case .addition: return .green.opacity(0.12)
        case .deletion: return .red.opacity(0.12)
        case .header, .context: return .clear
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                XgentCodeBlockHeader(title: title, text: text, canCollapse: canCollapse,
                                     lineCount: metrics.lineCount, labels: configuration.labels, collapsed: $state.collapsed, foreground: headerColor)
            }
            XgentCodeBlockScroll(maximumHeight: maximumHeight, hidden: canCollapse && state.collapsed, state: state) { codeBody }
                .accessibilityLabel(title ?? configuration.labels.code ?? "Code")
                .overlay(alignment: .topTrailing) {
                    if title == nil { XgentCodeBlockCopy(text: text, labels: configuration.labels).padding(4) }
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewportWidth = $0 }
        }
        .foregroundStyle(Color(xgentHex: palette.text))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if configuration.container == "card" {
                RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)).fill(Color(xgentHex: backgroundColor))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: configuration.container == "card" ? CGFloat(theme.radius.element) : 0))
        .overlay {
            if configuration.container == "card" {
                RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)).stroke(Color(xgentHex: palette.border), lineWidth: 1)
            }
        }
        .accessibilityIdentifier("xgent-code-block")
    }

    @ViewBuilder private var codeBody: some View {
        if language?.lowercased() == "diff" {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(XgentDiffRow.parse(metrics.displayText), id: \.index) { row in
                    HStack(spacing: 0) {
                        Text(row.oldLine.map { String($0) } ?? " ")
                            .frame(width: gutterWidth, alignment: .trailing)
                        Text(row.newLine.map { String($0) } ?? " ")
                            .frame(width: gutterWidth, alignment: .trailing)
                        Text(row.text.isEmpty ? " " : row.text)
                            .padding(.leading, 8)
                            .fixedSize(horizontal: true, vertical: true)
                    }
                    .foregroundStyle(diffForeground(row))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(diffBackground(row))
                }
            }
            .font(codeFont)
            .textSelection(.enabled)
            .frame(minWidth: viewportWidth, alignment: .leading)
            .padding(.vertical, 10)
        } else {
            XgentReadOnlyCodeText(source: text, display: metrics.displayText, language: language ?? "plaintext",
                                 theme: configuration.syntaxTheme, foreground: configuration.syntaxForeground, query: highlightCode, state: state)
                .font(codeFont)
                .textSelection(.enabled)
                .padding(12)
        }
    }
}
