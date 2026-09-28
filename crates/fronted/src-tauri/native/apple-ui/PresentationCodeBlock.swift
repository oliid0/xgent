import SwiftUI

// Tool evidence and Markdown fences use the same scrolling/copy surface.
struct XgentCodeBlock: View {
    let text: String
    var language: String?
    var label: String?
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 13
    @State private var copied = false

    private var palette: XgentPalette { theme.palette(for: colorScheme) }

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
                XgentSwiftHighlighter(dark: colorScheme == .dark).highlightCode(text, language: language)
                    .font(.system(size: fontSize * CGFloat(theme.fontScale), design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
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
