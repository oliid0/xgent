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
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 13
    @State private var copied = false
    @State private var viewportWidth: CGFloat = 0

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var diffRows: [XgentDiffRow] { XgentDiffRow.parse(text) }
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
            HStack(spacing: 8) {
                Text(label ?? language ?? "Code")
                    .font(.caption.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Button {
                    XgentCodeClipboard.copy(text)
                    copied = true
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(copied ? "Copied" : "Copy code"))
            }
            .padding(.horizontal, 12)
            Divider()
            ScrollView(.horizontal) {
                if language?.lowercased() == "diff" {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(diffRows, id: \.index) { row in
                            HStack(spacing: 0) {
                                Text(row.oldLine.map { String($0) } ?? " ")
                                    .frame(width: gutterWidth, alignment: .trailing)
                                Text(row.newLine.map { String($0) } ?? " ")
                                    .frame(width: gutterWidth, alignment: .trailing)
                                Text(row.text.isEmpty ? " " : row.text)
                                    .padding(.leading, 8)
                                    .fixedSize(horizontal: true, vertical: false)
                            }
                            .foregroundStyle(diffForeground(row))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(diffBackground(row))
                        }
                    }
                    .font(.system(size: fontSize * CGFloat(theme.fontScale), design: .monospaced))
                    .textSelection(.enabled)
                    .frame(minWidth: viewportWidth, alignment: .leading)
                    .padding(.vertical, 10)
                } else {
                    XgentSwiftHighlighter(dark: colorScheme == .dark).highlightCode(text, language: language)
                        .font(.system(size: fontSize * CGFloat(theme.fontScale), design: .monospaced))
                        .textSelection(.enabled)
                        .padding(12)
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewportWidth = $0 }
        }
        .foregroundStyle(Color(xgentHex: palette.text))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: palette.muted), in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14).stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            copied = false
        }
        .onChange(of: text) { _, _ in copied = false }
    }
}
