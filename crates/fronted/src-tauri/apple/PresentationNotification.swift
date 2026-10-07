import Accessibility
import SwiftUI
import SystemNotification

struct XgentNotificationCard: View {
    let document: XgentDocument
    let maximumHeight: CGFloat
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .body) private var fontSize: CGFloat = 17
    @AccessibilityFocusState private var readingWithVoiceOver: Bool
    @State private var hovering = false
    @State private var scrolling = false
    @State private var messageHeight: CGFloat = 44
    private var reading: Bool { hovering || readingWithVoiceOver || scrolling }
    private var message: XgentNode? { document.nodes.first }

    var body: some View {
        let palette = theme.palette(for: scheme)
        HStack(alignment: .top, spacing: 4) {
            Image(systemName: message?.icon ?? "info.circle")
                .font(.system(size: 20))
                .foregroundStyle(message?.status == "error" ? Color.red : Color(xgentHex: palette.accent))
                .padding(.leading, 8)
                .padding(.top, 12)
                .accessibilityHidden(true)
            ScrollView {
                notificationMessage(palette: palette)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { messageHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .onScrollPhaseChange { _, phase in scrolling = phase != .idle }
            .frame(height: min(max(44, messageHeight), max(44, maximumHeight - 8)))
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityFocused($readingWithVoiceOver)
            Button { model.dismiss(document) } label: {
                Image(systemName: "xmark").frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(message?.children?.first?.label ?? "Close")
        }
        .padding(4)
        .background(Color(xgentHex: palette.popover), in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)))
        .overlay { RoundedRectangle(cornerRadius: CGFloat(theme.radius.element)).stroke(Color(xgentHex: palette.border), lineWidth: 1) }
        .accessibilityIdentifier("xgent-native-notification")
        .onHover { hovering = $0 }
        .onChange(of: reading) { _, value in model.setNotificationReading(value, in: document) }
        .onDisappear { if reading { model.setNotificationReading(false, in: document) } }
        .onAppear {
            if model.consumeNotificationAnnouncement(document) {
                var text = AttributedString(message?.text ?? "")
                if message?.status == "error" { text.accessibilitySpeechAnnouncementPriority = .high }
                AccessibilityNotification.Announcement(text).post()
            }
        }
    }

    private func notificationMessage(palette: XgentPalette) -> some View {
        SystemNotificationMessage(
                text: LocalizedStringKey(message?.text ?? ""),
                style: .init(
                    iconTextSpacing: 0,
                    padding: .init(width: 12, height: 12),
                    textColor: Color(xgentHex: palette.text),
                    textFont: .system(size: fontSize * CGFloat(theme.fontScale)),
                    textAlignment: .leading
                )
            )
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct XgentNotificationOverlay: ViewModifier {
    @ObservedObject var model: XgentPresentationModel
    var enabled = true
    @State private var availableHeight: CGFloat = 720
    private var notifications: [XgentDocument] { Array(model.documents.filter { $0.mode == .toast }.suffix(4).reversed()) }

    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { availableHeight = $0 }
        .overlay(alignment: .topTrailing) {
            if enabled {
                VStack(alignment: .trailing, spacing: 8) {
                    ForEach(notifications) { document in
                        XgentNotificationCard(document: document,
                            maximumHeight: max(52, (availableHeight - 24 - CGFloat(max(0, notifications.count - 1)) * 8) / CGFloat(max(1, notifications.count))),
                            model: model)
                            .modifier(XgentPresentationThemeModifier(theme: document.theme ?? .fallback, appearance: document.appearance))
                            .preferredColorScheme(document.colorScheme)
                    }
                }
                .frame(maxWidth: 400)
                .padding(12)
            }
        }
    }
}
