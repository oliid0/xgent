import Accessibility
import SwiftUI

struct XgentCodeBlockCopy: View {
    let text: String
    let labels: XgentCodeBlockConfiguration.Labels
    @Environment(\.xgentPresentationTheme) private var theme
    @State private var copied = false
    @State private var generation = 0

    private var controlSize: CGFloat {
        #if os(iOS)
        return max(44, CGFloat(theme.control.small))
        #else
        return CGFloat(theme.control.small)
        #endif
    }

    var body: some View {
        Button {
            guard XgentCodeClipboard.copy(text) else { return }
            copied = true
            generation &+= 1
            var announcement = AttributedString(labels.copied)
            announcement.accessibilitySpeechAnnouncementPriority = .low
            AccessibilityNotification.Announcement(announcement).post()
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .font(.system(size: 14))
                .frame(width: controlSize, height: controlSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(labels.copy)
        .accessibilityLabel(copied ? labels.copied : labels.copy)
        .accessibilityIdentifier("xgent-code-copy")
        .task(id: generation) {
            guard copied else { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            copied = false
        }
        .onChange(of: text) { _, _ in
            copied = false
            generation &+= 1
        }
    }
}
