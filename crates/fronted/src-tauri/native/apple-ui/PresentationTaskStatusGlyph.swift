import SwiftUI

struct XgentTaskStatusGlyph: View {
    let status: String?

    var body: some View {
        Group {
            switch status {
            case "completed": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            case "error": Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
            case "running": ProgressView().controlSize(.small)
            case "paused": Image(systemName: "pause.circle").foregroundStyle(.secondary)
            default: Image(systemName: "clock").foregroundStyle(.secondary)
            }
        }.frame(width: 20, height: 20).accessibilityHidden(true)
    }
}
