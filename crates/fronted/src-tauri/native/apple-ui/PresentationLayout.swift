import Foundation
import AVKit
import PDFKit
import QuickLook
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif

private struct XgentAVPreview: View {
    let data: Data
    let mimeType: String
    let label: String
    @State private var player: AVPlayer?
    @State private var temporaryURL: URL?
    @State private var isPlaying = false
    @State private var failure: String?

    private var isVideo: Bool { mimeType.hasPrefix("video/") }

    private var fileExtension: String {
        switch mimeType {
        case "audio/mpeg": return "mp3"
        case "audio/mp4", "audio/x-m4a": return "m4a"
        case "audio/wav", "audio/x-wav": return "wav"
        case "video/quicktime": return "mov"
        case "video/mp4": return "mp4"
        default: return isVideo ? "video" : "audio"
        }
    }

    var body: some View {
        Group {
            if let failure {
                Label(failure, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            } else if let player {
                if isVideo {
                    VideoPlayer(player: player)
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "waveform")
                            .font(.system(size: 52)).foregroundStyle(.secondary)
                        Button {
                            if isPlaying { player.pause() } else { player.play() }
                            isPlaying.toggle()
                        } label: {
                            Label(isPlaying ? "Pause" : "Play",
                                  systemImage: isPlaying ? "pause.fill" : "play.fill")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(label)
        .task(id: data) {
            player?.pause()
            if let temporaryURL { try? FileManager.default.removeItem(at: temporaryURL) }
            do {
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension(fileExtension)
                try data.write(to: url, options: .atomic)
                temporaryURL = url
                player = AVPlayer(url: url)
                failure = nil
                isPlaying = false
            } catch {
                failure = error.localizedDescription
                player = nil
            }
        }
        .onDisappear {
            player?.pause()
            player = nil
            if let temporaryURL { try? FileManager.default.removeItem(at: temporaryURL) }
            temporaryURL = nil
            isPlaying = false
        }
    }
}

#if os(iOS)
private struct XgentPDFPreview: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.document = PDFDocument(data: data)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document?.dataRepresentation() != data {
            view.document = PDFDocument(data: data)
            view.autoScales = true
        }
    }
}
#else
private struct XgentPDFPreview: NSViewRepresentable {
    let data: Data

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.document = PDFDocument(data: data)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document?.dataRepresentation() != data {
            view.document = PDFDocument(data: data)
            view.autoScales = true
        }
    }
}
#endif

// Handwritten native content for desktop conversations, files and tool panels.
extension XgentNodeView {
    private var palette: XgentPalette { presentationTheme.palette(for: colorScheme) }

    var nativeText: some View {
        Text(node.text ?? "")
            .modifier(XgentControlTypography(node: node))
            .foregroundStyle(Color(xgentHex: node.secondary == true ? palette.secondaryText : palette.text))
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }

    var nativeHeading: some View {
        Text(node.text ?? "")
            .modifier(XgentControlTypography(node: node)).fontWeight(.semibold)
            .foregroundStyle(Color(xgentHex: palette.text))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    private var semanticColor: Color {
        switch node.status {
        case "completed": return .green
        case "error": return .red
        case "paused", "pending": return .secondary
        default: return Color(xgentHex: palette.accent)
        }
    }

    @ViewBuilder private var semanticStatusIcon: some View {
        switch node.status {
        case "completed": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case "error": Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
        case "running": ProgressView().controlSize(.small)
        case "paused": Image(systemName: "pause.circle").foregroundStyle(.secondary)
        default: Image(systemName: "circle").foregroundStyle(.secondary)
        }
    }

    private var attributedText: AttributedString {
        (try? AttributedString(
            markdown: node.text ?? "",
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(node.text ?? "")
    }

    var nativeMarkdown: some View {
        XgentMarkdown(text: node.text ?? "", codeConfiguration: .decode(node.value?.text, fallback: .markdown),
                      highlightCode: { source, language in await model.highlightCode(node, in: document, source: source, language: language) },
                      renderDiagram: { source, dark in await model.renderDiagram(node, in: document, source: source, dark: dark) })
    }

    var nativeCodeBlock: some View {
        XgentCodeBlock(text: node.text ?? "", language: node.language, label: node.label,
                       configuration: .decode(node.value?.text, fallback: .plain),
                       highlightCode: { source, language in await model.highlightCode(node, in: document, source: source, language: language) })
    }

    var nativeBadge: some View {
        Text(node.label ?? node.text ?? "")
            .font(.system(size: CGFloat(presentationTheme.typography.caption * presentationTheme.fontScale),
                          weight: .medium))
            .foregroundStyle(semanticColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(semanticColor.opacity(0.12), in: Capsule())
    }

    var nativeStatusDot: some View {
        HStack(spacing: 7) {
            Circle().fill(semanticColor).frame(width: 8, height: 8)
            Text(node.label ?? node.text ?? "")
                .font(.system(size: CGFloat(presentationTheme.typography.supporting * presentationTheme.fontScale)))
                .foregroundStyle(Color(xgentHex: palette.secondaryText))
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder var nativeBanner: some View {
        if node.variant == "error-screen" {
            XgentErrorScreen(node: node, document: document, model: model)
        } else {
            HStack(alignment: .top, spacing: CGFloat(presentationTheme.spacing.sm)) {
                semanticStatusIcon
                VStack(alignment: .leading, spacing: 4) {
                    if let label = node.label, !label.isEmpty {
                        Text(label).font(.headline)
                    }
                    if let text = node.text, !text.isEmpty {
                        Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    }
                    children
                }
            }
            .padding(CGFloat(presentationTheme.spacing.md))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(semanticColor.opacity(0.1),
                        in: RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous))
        }
    }

    var nativeEmptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: node.icon ?? "tray")
                .font(.system(size: 28)).foregroundStyle(Color(xgentHex: palette.secondaryText))
            Text(node.label ?? "").font(.headline).multilineTextAlignment(.center)
            if let text = node.text, !text.isEmpty {
                Text(text).font(.subheadline).foregroundStyle(Color(xgentHex: palette.secondaryText))
                    .multilineTextAlignment(.center)
            }
            children
        }
        .padding(24)
        .frame(maxWidth: .infinity, minHeight: 180)
    }

    var nativeProgressBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(node.label ?? "").font(.subheadline)
                Spacer()
                if let current = node.current, let total = node.total {
                    Text("\(Int(current))/\(Int(total))")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            ProgressView(value: node.current ?? 0, total: max(node.total ?? 1, 1))
                .tint(semanticColor)
        }
        .accessibilityElement(children: .combine)
    }

    var nativeCollapsible: some View {
        XgentDisclosure(node: node, document: document, model: model)
            .id(node.value?.text ?? node.id)
    }

    @ViewBuilder var nativeChatMessage: some View {
        if node.role == "system" {
            HStack {
                Spacer()
                VStack(spacing: 6) { children }
                    .font(.subheadline)
                    .foregroundStyle(Color(xgentHex: palette.secondaryText))
                    .multilineTextAlignment(.center)
                Spacer()
            }
            .padding(.vertical, 6)
        } else {
            HStack(alignment: .top, spacing: 0) {
                if node.role == "user" { Spacer(minLength: 44) }
                VStack(alignment: .leading, spacing: 10) {
                    if let label = node.label, !label.isEmpty {
                        Text(label)
                            .font(.system(
                                size: CGFloat(presentationTheme.typography.caption * presentationTheme.fontScale),
                                weight: .semibold
                            ))
                            .foregroundStyle(Color(xgentHex: palette.secondaryText))
                    }
                    children
                }
                .padding(node.role == "user" ? 12 : 0)
                .background {
                    if node.role == "user" {
                        RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.chat), style: .continuous)
                            .fill(Color(xgentHex: palette.accent).opacity(colorScheme == .dark ? 0.22 : 0.12))
                    }
                }
                if node.role != "user" { Spacer(minLength: 0) }
            }
            .frame(maxWidth: .infinity, alignment: node.role == "user" ? .trailing : .leading)
            .padding(.horizontal, CGFloat(presentationTheme.spacing.lg))
            .padding(.vertical, 5)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(node.role == "user" ? "You" : "Assistant")
        }
    }

    var nativeThinking: some View {
        DisclosureGroup(isExpanded: $expanded) {
            Text(attributedText)
                .font(.system(size: CGFloat(presentationTheme.typography.supporting * presentationTheme.fontScale)))
                .foregroundStyle(Color(xgentHex: palette.secondaryText))
                .textSelection(.enabled)
                .padding(.top, 6)
        } label: {
            HStack(spacing: 8) {
                if node.status == "running" { ProgressView().controlSize(.small) }
                else { Image(systemName: "brain.head.profile") }
                Text(node.label ?? "Reasoning").font(.subheadline.weight(.medium))
            }
            .foregroundStyle(Color(xgentHex: palette.secondaryText))
        }
        .padding(.vertical, 4)
    }

    var nativeToolCall: some View {
        Group {
            if node.variant == "timeline" || node.status == "running" {
                VStack(alignment: .leading, spacing: 8) {
                    nativeToolCallLabel
                    nativeToolCallContent
                }
            } else {
                DisclosureGroup(isExpanded: $expanded) {
                    nativeToolCallContent
                } label: {
                    nativeToolCallLabel
                }
            }
        }
        .tint(Color(xgentHex: palette.secondaryText))
        .padding(node.variant == "timeline" ? 2 : 10)
        .background {
            if node.variant != "timeline" {
                RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
                    .fill(Color(xgentHex: palette.surface).opacity(0.72))
            }
        }
        .overlay {
            if node.variant != "timeline" {
                RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
                    .stroke(Color(xgentHex: palette.border), lineWidth: 1)
            }
        }
    }

    private var nativeToolCallContent: some View {
        VStack(alignment: .leading, spacing: 8) { children }.padding(.top, 8)
    }

    private var nativeToolCallLabel: some View {
        XgentToolCallHeader(node: node)
    }

    var nativeActivityPreview: some View {
        Button { model.send(node, in: document) } label: {
            ZStack {
                XgentDataImage(encoded: model.value(node, in: document).text, maximumPixelSize: 300,
                               contentMode: .fill, label: node.label ?? "Activity") {
                    activityFallback
                }
                if node.status == "running" {
                    ProgressView().controlSize(.small)
                        .padding(6)
                        .background(.regularMaterial, in: Circle())
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                        .padding(5)
                }
            }
            .frame(width: 100, height: 65)
            .clipShape(RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element),
                                        style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element),
                                           style: .continuous))
        }
        .buttonStyle(.plain)
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
        .accessibilityLabel(node.label ?? "Activity")
        .accessibilityValue(node.text ?? "")
    }

    private var activityFallback: some View {
        ZStack {
            Color(xgentHex: palette.surface).opacity(0.78)
            VStack(spacing: 5) {
                Image(systemName: node.icon ?? "hammer")
                    .font(.system(size: 19, weight: .medium))
                Text(node.label ?? "Activity")
                    .font(.system(size: CGFloat(10 * presentationTheme.fontScale), weight: .medium))
                    .foregroundStyle(Color(xgentHex: palette.secondaryText))
                    .lineLimit(1)
            }
        }
    }

    private func reportBrowserViewport(_ rect: CGRect, visible: Bool) {
        guard rect.origin.x.isFinite, rect.origin.y.isFinite,
              rect.width.isFinite, rect.height.isFinite else { return }
        let payload = String(
            format: "{\"x\":%.3f,\"y\":%.3f,\"width\":%.3f,\"height\":%.3f,\"visible\":%@,\"scaleFactor\":1}",
            rect.origin.x, rect.origin.y, max(rect.width, 1), max(rect.height, 1), visible ? "true" : "false"
        )
        model.send(node, in: document, value: .string(payload), editing: true)
    }

    var nativeBrowserViewport: some View {
        GeometryReader { proxy in
            Color.white
                .onAppear { reportBrowserViewport(proxy.frame(in: .global), visible: true) }
                .onChange(of: proxy.frame(in: .global)) { _, rect in
                    reportBrowserViewport(rect, visible: true)
                }
                .onDisappear { reportBrowserViewport(proxy.frame(in: .global), visible: false) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(node.label ?? "Browser content")
    }

    private var mediaData: Data? {
        let encoded = model.value(node, in: document).text
        let payload = encoded.split(separator: ",", maxSplits: 1).last.map(String.init) ?? encoded
        return Data(base64Encoded: payload, options: .ignoreUnknownCharacters)
    }

    @ViewBuilder var nativeMediaPreview: some View {
        if let mimeType = node.language,
           mimeType.hasPrefix("audio/") || mimeType.hasPrefix("video/"), let data = mediaData {
            XgentAVPreview(data: data, mimeType: mimeType, label: node.label ?? "Media preview")
        } else if node.language == "application/pdf", let data = mediaData {
            XgentPDFPreview(data: data)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(node.label ?? "PDF document")
        } else if !model.value(node, in: document).text.isEmpty {
            if let mimeType = node.language,
               !mimeType.hasPrefix("image/"), let data = mediaData {
                XgentQuickLookPreview(data: data, mimeType: mimeType, label: node.label ?? "Document")
            } else {
                XgentImagePreview(encoded: model.value(node, in: document).text,
                                  label: node.label ?? "Image preview")
            }
        } else {
            Label(node.label ?? "No preview", systemImage: "doc.questionmark")
                .foregroundStyle(Color(xgentHex: palette.secondaryText))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private func nativeCollection(label: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label, !label.isEmpty {
                Text(label)
                    .font(.system(
                        size: CGFloat(presentationTheme.typography.supporting * presentationTheme.fontScale),
                        weight: .semibold
                    ))
                    .foregroundStyle(Color(xgentHex: palette.secondaryText))
                    .padding(.horizontal, 4)
                    .accessibilityAddTraits(.isHeader)
            }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array((node.children ?? []).enumerated()), id: \.element.id) { index, child in
                    if index > 0 {
                        Divider()
                            .padding(.leading, child.icon == nil ? 0 : 36)
                            .overlay(Color(xgentHex: palette.border))
                    }
                    XgentNodeView(node: child, document: document, model: model)
                        .padding(.vertical, 6)
                }
            }
            .padding(.horizontal, 12)
            .modifier(XgentGlassSurface())
        }
    }

    @ViewBuilder var nativeList: some View {
        #if os(iOS)
        if document.formFactor == .mobile {
            List(node.children ?? []) { child in
                XgentNodeView(node: child, document: document, model: model)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .frame(maxHeight: .infinity)
        } else {
            List(node.children ?? []) { child in
                XgentNodeView(node: child, document: document, model: model)
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .frame(maxHeight: .infinity)
        }
        #else
        List(node.children ?? []) { child in
            XgentNodeView(node: child, document: document, model: model)
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .frame(maxHeight: .infinity)
        #endif
    }
    var nativeTreeRow: some View {
        Button { model.send(node, in: document) } label: {
            HStack(spacing: 9) {
                Image(systemName: node.icon ?? "doc").frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.label ?? "").lineLimit(1).truncationMode(.middle)
                    if let text = node.text, !text.isEmpty {
                        Text(text).font(.caption).foregroundStyle(Color(xgentHex: palette.secondaryText))
                            .lineLimit(1).truncationMode(.middle)
                    }
                }
                Spacer(minLength: 6)
                if node.selected == true { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
            .frame(minHeight: 36)
            .padding(.horizontal, 8)
            .background(
                node.selected == true ? Color(xgentHex: palette.accent).opacity(0.12) : Color.clear,
                in: RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(node.secondary == true ? 0.62 : 1)
    }
    var nativeColorInput: some View {
        XgentColorInput(node: node, document: document, model: model)
    }

    var nativeTextArea: some View {
        XgentTextArea(node: node, document: document, model: model)
    }

    @ViewBuilder var nodeLabel: some View {
        if let icon = node.icon { Label(node.label ?? "", systemImage: icon) }
        else { Text(node.label ?? "") }
    }

    var navigationRow: some View {
        Button { model.send(node, in: document) } label: {
            HStack(spacing: 12) {
                if let icon = node.icon { Image(systemName: icon).frame(width: 24) }
                VStack(alignment: .leading, spacing: 4) {
                    Text(node.label ?? "")
                    if let text = node.text, !text.isEmpty {
                        Text(text).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                if node.selected == true { Image(systemName: "checkmark").foregroundStyle(.tint) }
                else { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
            }.frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    var composer: some View {
        VStack(alignment: .leading, spacing: CGFloat(presentationTheme.spacing.sm)) { children }
            .padding(CGFloat(presentationTheme.spacing.md))
            .modifier(XgentGlassSurface(radius: CGFloat(presentationTheme.radius.chat), floating: true))
            .padding(.horizontal, CGFloat(presentationTheme.spacing.md))
            .padding(.bottom, CGFloat(presentationTheme.spacing.sm))
    }

    var chatLayout: some View {
        VStack(spacing: 0) {
            ForEach((node.children ?? []).filter { $0.kind != .composer && $0.id != "workspace-panel-actions" }) { child in
                XgentNodeView(node: child, document: document, model: model)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ForEach((node.children ?? []).filter { $0.kind == .composer }) { child in
                XgentNodeView(node: child, document: document, model: model)
            }
        }
    }

    var composerInput: some View {
        XgentComposerInput(node: node, document: document, model: model)
    }

    var filePicker: some View {
        XgentAttachmentPicker(node: node, document: document, model: model)
    }


}

#if os(macOS)
private struct XgentSidebarWidthPreferenceKey: PreferenceKey {
    static let defaultValue = 360.0
    static func reduce(value: inout Double, nextValue: () -> Double) { value = nextValue() }
}
#endif

struct XgentRootLayout: View {
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("xgent.native.sidebar-width.v1") private var storedSidebarWidth = 360.0
    private var root: XgentDocument? { model.documents.last { $0.mode == .root } }
    private var sidebar: XgentDocument? { model.documents.last { $0.mode == .sidebar } }
    private var transitionAnimation: Animation? {
        guard !reduceMotion else { return nil }
        let motion = (root?.theme ?? .fallback).motion
        return .timingCurve(motion.curve[0], motion.curve[1], motion.curve[2], motion.curve[3],
                            duration: motion.medium / 1_000)
    }

    @ViewBuilder private func content(_ document: XgentDocument) -> some View {
        #if os(macOS)
        if document.mode == .sidebar && document.nodes.contains(where: { $0.id == "sidebar-layout" }) {
            XgentDesktopSidebar(document: document, model: model)
                .preferredColorScheme(document.colorScheme)
                .modifier(XgentPresentationThemeModifier(theme: document.theme ?? .fallback,
                                                        appearance: document.appearance))
        } else { genericContent(document) }
        #else
        genericContent(document)
        #endif
    }

    private func genericContent(_ document: XgentDocument) -> some View {
        XgentNodeChildren(nodes: document.nodes, document: document, model: model)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background { XgentThemeBackground() }
            .preferredColorScheme(document.colorScheme)
            .modifier(XgentPresentationThemeModifier(
                theme: document.theme ?? .fallback,
                appearance: document.appearance
            ))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let status = model.documents.last(where: { $0.mode == .status }) {
                XgentServiceStatusBanner(document: status, model: model)
            }
            application
        }
        .modifier(XgentCodeBlockViewport())
    }

    @ViewBuilder private var application: some View {
        #if os(macOS)
        XgentDesktopWorkspaceLayout(model: model,
                                   minimumMainWidth: 440 + (sidebar == nil ? 0 : CGFloat(min(480, max(280, storedSidebarWidth)))),
                                   enabled: root?.nodes.contains(where: { $0.kind == .chatLayout }) == true) {
            Group {
                if let sidebar, let root {
                    HSplitView {
                        content(sidebar)
                            .frame(
                                minWidth: 280,
                                idealWidth: CGFloat(min(480, max(280, storedSidebarWidth))),
                                maxWidth: 480
                            )
                            .background {
                                GeometryReader { geometry in
                                    Color.clear.preference(
                                        key: XgentSidebarWidthPreferenceKey.self,
                                        value: Double(geometry.size.width)
                                    )
                                }
                            }
                            .transition(.move(edge: .leading).combined(with: .opacity))
                        content(root)
                            .accessibilityIdentifier("xgent-native-root")
                            .onAppear { NSLog("XgentNativeUI root rendered") }
                    }
                    .onPreferenceChange(XgentSidebarWidthPreferenceKey.self) { width in
                        storedSidebarWidth = min(480, max(280, width))
                    }
                } else if let sidebar {
                    content(sidebar)
                } else if let root {
                    content(root)
                        .accessibilityIdentifier("xgent-native-root")
                        .onAppear { NSLog("XgentNativeUI root rendered") }
                }
            }
            .animation(transitionAnimation, value: sidebar?.id)
        }
        #else
        if let root, root.formFactor == .mobile {
            if root.nodes.contains(where: { $0.kind == .chatLayout }) {
                XgentIOSRootPresentation(document: root, sidebar: sidebar, model: model)
                    .onAppear { NSLog("XgentNativeUI root rendered: handwritten iPhone chat shell") }
            } else if root.nodes.contains(where: { $0.kind == .browserLayout }) {
                XgentIOSWorkspacePresentation(document: root, model: model)
                    .onAppear { NSLog("XgentNativeUI root rendered: handwritten iPhone workspace shell") }
            } else {
                XgentIOSPagePresentation(document: root, sidebar: sidebar, model: model)
                    .onAppear { NSLog("XgentNativeUI root rendered: handwritten iPhone page shell") }
            }
        } else if let root {
            content(root)
                .accessibilityIdentifier("xgent-native-root")
                .onAppear { NSLog("XgentNativeUI root rendered") }
        }
        #endif
    }
}
