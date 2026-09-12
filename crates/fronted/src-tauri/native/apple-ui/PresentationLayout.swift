import Foundation
import AVKit
import PDFKit
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

// Semantic layout mappings shared by all native screens. Business state remains in TS.
extension XgentNodeView {
    private var palette: XgentPalette { presentationTheme.palette(for: colorScheme) }

    var nativeText: some View {
        Text(node.text ?? "")
            .font(.system(size: CGFloat(presentationTheme.typography.body * presentationTheme.fontScale)))
            .foregroundStyle(Color(xgentHex: node.secondary == true ? palette.secondaryText : palette.text))
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }

    var nativeHeading: some View {
        Text(node.text ?? "")
            .font(.system(size: CGFloat(presentationTheme.typography.body * presentationTheme.fontScale),
                          weight: .semibold))
            .foregroundStyle(Color(xgentHex: palette.text))
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
        Text(attributedText)
            .font(.system(size: CGFloat(presentationTheme.typography.body * presentationTheme.fontScale)))
            .foregroundStyle(Color(xgentHex: palette.text))
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }

    var nativeCodeBlock: some View {
        ScrollView(.horizontal) {
            Text(node.text ?? "")
                .font(.system(size: CGFloat(presentationTheme.typography.supporting * presentationTheme.fontScale),
                              design: .monospaced))
                .foregroundStyle(Color(xgentHex: palette.text))
                .textSelection(.enabled)
                .padding(CGFloat(presentationTheme.spacing.md))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: palette.background),
                    in: RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
        .accessibilityLabel(node.label ?? node.language ?? "Code")
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

    var nativeBanner: some View {
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

    var nativeSlider: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(node.label ?? "")
                Spacer()
                Text(numberBinding.wrappedValue.formatted()).foregroundStyle(.secondary)
            }
            Slider(
                value: numberBinding,
                in: (node.minimum ?? 0)...(node.maximum ?? 1),
                step: node.step ?? 0.1
            )
        }
        .frame(minHeight: 44)
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
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) { children }.padding(.top, 8)
        } label: {
            Text(node.label ?? "").font(.subheadline.weight(.medium))
        }
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
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) { children }
                .padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                semanticStatusIcon
                Text(node.label ?? "Tool").font(.system(.subheadline, design: .monospaced).weight(.medium))
                if let text = node.text, !text.isEmpty {
                    Text(text).font(.caption).foregroundStyle(Color(xgentHex: palette.secondaryText))
                        .lineLimit(1).truncationMode(.middle)
                }
            }
        }
        .padding(10)
        .background(Color(xgentHex: palette.surface).opacity(0.72),
                    in: RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
    }

    var nativeActivityPreview: some View {
        Button { model.send(node, in: document) } label: {
            ZStack {
                if let data = mediaData {
                    #if os(iOS)
                    if let image = UIImage(data: data) {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        activityFallback
                    }
                    #else
                    if let image = NSImage(data: data) {
                        Image(nsImage: image).resizable().scaledToFill()
                    } else {
                        activityFallback
                    }
                    #endif
                } else {
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

    var nativeTaskProgress: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 9) { children }.padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                semanticStatusIcon
                Text(node.label ?? "Tasks").lineLimit(1)
                Spacer(minLength: 8)
                if let current = node.current, let total = node.total {
                    Text("\(Int(current))/\(Int(total))")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .font(.system(size: CGFloat(presentationTheme.typography.supporting * presentationTheme.fontScale)))
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(
            Color(xgentHex: palette.surface).opacity(0.78),
            in: RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element),
                                 style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
        .accessibilityValue(node.text ?? "")
    }

    var nativeTaskStep: some View {
        HStack(alignment: .top, spacing: 9) {
            semanticStatusIcon
            VStack(alignment: .leading, spacing: 2) {
                Text(node.label ?? "").font(.subheadline.weight(node.status == "running" ? .semibold : .regular))
                if let text = node.text, !text.isEmpty {
                    Text(text).font(.caption).foregroundStyle(Color(xgentHex: palette.secondaryText))
                }
            }
        }
        .accessibilityElement(children: .combine)
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
                .onDisappear { reportBrowserViewport(.zero, visible: false) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(node.label ?? "Browser content")
    }

    var nativeBrowserLayout: some View {
        VStack(spacing: 0) { children }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var mediaData: Data? {
        let encoded = model.value(node, in: document).text
        let payload = encoded.split(separator: ",", maxSplits: 1).last.map(String.init) ?? encoded
        return Data(base64Encoded: payload, options: .ignoreUnknownCharacters)
    }

    @ViewBuilder var nativeMediaPreview: some View {
        if let data = mediaData, let mimeType = node.language,
           mimeType.hasPrefix("audio/") || mimeType.hasPrefix("video/") {
            XgentAVPreview(data: data, mimeType: mimeType, label: node.label ?? "Media preview")
        } else if let data = mediaData, node.language == "application/pdf" {
            XgentPDFPreview(data: data)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(node.label ?? "PDF document")
        } else if let data = mediaData {
            ScrollView([.horizontal, .vertical]) {
                #if os(iOS)
                if let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFit()
                        .accessibilityLabel(node.label ?? "Image preview")
                } else {
                    Label(node.label ?? "Unable to preview image", systemImage: "exclamationmark.triangle")
                }
                #else
                if let image = NSImage(data: data) {
                    Image(nsImage: image).resizable().scaledToFit()
                        .accessibilityLabel(node.label ?? "Image preview")
                } else {
                    Label(node.label ?? "Unable to preview image", systemImage: "exclamationmark.triangle")
                }
                #endif
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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

    var nativeList: some View { nativeCollection(label: nil) }
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
    var nativeSettingsGroup: some View { nativeCollection(label: node.label) }
    var nativeSettingsLayout: some View {
        let panes = node.children ?? []
        return HStack(spacing: 0) {
            if let sidebar = panes.first {
                XgentNodeView(node: sidebar, document: document, model: model)
                    .frame(width: 280)
                    .frame(maxHeight: .infinity, alignment: .topLeading)
                    .background(Color(xgentHex: palette.surface).opacity(0.55))
            }
            Divider().overlay(Color(xgentHex: palette.border))
            if panes.count > 1 {
                XgentNodeView(node: panes[1], document: document, model: model)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .frame(minWidth: 900, idealWidth: 1040, minHeight: 620, idealHeight: 720)
    }
    var nativeSection: some View { nativeCollection(label: node.label) }

    @ViewBuilder private var textEntry: some View {
        if node.secure == true {
            SecureField(node.text ?? "", text: textBinding)
                .accessibilityLabel(node.label ?? "")
        } else {
            TextField(node.text ?? "", text: textBinding)
                .accessibilityLabel(node.label ?? "")
        }
    }

    @ViewBuilder var nativeTextInput: some View {
        if document.mode == .sheet {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    Text(node.label ?? "")
                    textEntry
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(Color(xgentHex: palette.surface),
                                    in: RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element),
                                                         style: .continuous))
                }
            } else {
                HStack(spacing: 12) {
                    Text(node.label ?? "")
                    Spacer(minLength: 12)
                    textEntry
                        .textFieldStyle(.plain)
                        .multilineTextAlignment(.trailing)
                        .frame(minWidth: 120, idealWidth: 220, maxWidth: 320)
                }
                .frame(minHeight: 44)
            }
        } else {
            textEntry
                .textFieldStyle(.plain)
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .background(Color(xgentHex: palette.surface),
                            in: RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element),
                                                 style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
                        .stroke(Color(xgentHex: palette.border), lineWidth: 1)
                }
        }
    }

    private var colorBinding: Binding<Color> {
        Binding(
            get: { Color(xgentHex: model.value(node, in: document).text) },
            set: { color in
                #if os(iOS)
                let resolved = UIColor(color)
                var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
                guard resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return }
                #else
                guard let resolved = NSColor(color).usingColorSpace(.sRGB) else { return }
                let red = resolved.redComponent, green = resolved.greenComponent
                let blue = resolved.blueComponent
                #endif
                let value = String(format: "#%02x%02x%02x", Int(red * 255), Int(green * 255), Int(blue * 255))
                model.send(node, in: document, value: .string(value), editing: true)
            }
        )
    }

    var nativeColorInput: some View {
        ColorPicker(node.label ?? "", selection: colorBinding, supportsOpacity: false)
            .frame(minHeight: 44)
    }

    var nativeTextArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label = node.label, !label.isEmpty { Text(label).font(.subheadline) }
            TextEditor(text: textBinding)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 100)
                .padding(8)
                .background(Color(xgentHex: palette.surface),
                            in: RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element),
                                                 style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: CGFloat(presentationTheme.radius.element), style: .continuous)
                        .stroke(Color(xgentHex: palette.border), lineWidth: 1)
                }
                .accessibilityLabel(node.label ?? node.text ?? "")
        }
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
            ForEach((node.children ?? []).filter { $0.kind != .composer }) { child in
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
        TextField(node.label ?? "", text: textBinding, axis: .vertical)
            .lineLimit(1...6).textFieldStyle(.plain)
            .font(.body).padding(.vertical, 8)
            .accessibilityLabel(node.label ?? "")
    }

    var filePicker: some View {
        XgentAttachmentPicker(node: node, document: document, model: model)
    }

    var iconButton: some View {
        Button { model.send(node, in: document) } label: {
            Image(systemName: node.icon ?? "ellipsis")
                .font(.system(size: 20)).frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(node.prominent == true ? Color.white : Color.primary)
        .modifier(XgentGlassCircle(prominent: node.prominent == true))
        .accessibilityLabel(node.label ?? "")
    }
}

struct XgentRootLayout: View {
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var root: XgentDocument? { model.documents.last { $0.mode == .root } }
    private var sidebar: XgentDocument? { model.documents.last { $0.mode == .sidebar } }
    private var transitionAnimation: Animation? {
        guard !reduceMotion else { return nil }
        let motion = (root?.theme ?? .fallback).motion
        return .timingCurve(motion.curve[0], motion.curve[1], motion.curve[2], motion.curve[3],
                            duration: motion.medium / 1_000)
    }

    @ViewBuilder private func content(_ document: XgentDocument) -> some View {
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
        #if os(macOS)
        HStack(spacing: 0) {
            if let sidebar {
                content(sidebar)
                    .frame(width: 320)
                    .transition(.move(edge: .leading).combined(with: .opacity))
                Divider()
            }
            if let root {
                content(root)
                    .accessibilityIdentifier("xgent-native-root")
                    .onAppear { NSLog("XgentNativeUI root rendered") }
            }
        }
        .animation(transitionAnimation, value: sidebar?.id)
        #else
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                if let root {
                    content(root)
                        .accessibilityIdentifier("xgent-native-root")
                        .onAppear { NSLog("XgentNativeUI root rendered") }
                        .accessibilityHidden(sidebar != nil)
                        .offset(x: sidebar == nil ? 0 : min(340, geometry.size.width * 0.82))
                }
                if let sidebar {
                    Button { model.dismiss(sidebar) } label: { Color.black.opacity(0.1) }
                        .buttonStyle(.plain).accessibilityLabel(Text("Close sidebar"))
                    content(sidebar)
                        .frame(width: min(340, geometry.size.width * 0.82), height: geometry.size.height)
                        .transition(.move(edge: .leading))
                        .gesture(DragGesture().onEnded {
                            if $0.translation.width < -60 { model.dismiss(sidebar) }
                        })
                }
            }
            .animation(transitionAnimation, value: sidebar?.id)
            .clipped()
        }
        #endif
    }
}
