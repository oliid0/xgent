#if os(iOS)
import AVKit
import Foundation
import PDFKit
import SwiftUI
import UIKit

// iOS has a deliberately handwritten presentation layer. The wire nodes below
// carry state and actions only; no generated Astryx-to-SwiftUI renderer is used.
struct XgentIOSNodes: View {
    let nodes: [XgentNode]
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        ForEach(nodes) { node in
            XgentIOSNode(node: node, document: document, model: model)
        }
    }
}

private struct XgentIOSAccessibility: ViewModifier {
    let node: XgentNode

    @ViewBuilder func body(content: Content) -> some View {
        if let label = node.accessibilityLabel {
            content
                .accessibilityLabel(label)
                .accessibilityHint(node.accessibilityHint ?? "")
                .accessibilityValue(node.accessibilityValue ?? "")
        } else if let hint = node.accessibilityHint {
            content.accessibilityHint(hint).accessibilityValue(node.accessibilityValue ?? "")
        } else if let value = node.accessibilityValue {
            content.accessibilityValue(value)
        } else {
            content
        }
    }
}

private struct XgentIOSNodeFrame: ViewModifier {
    let node: XgentNode
    let alignment: Alignment

    func body(content: Content) -> some View {
        content
            .frame(
                minWidth: node.minWidth.map { CGFloat($0) },
                maxWidth: node.fill == true ? .infinity : node.maxWidth.map { CGFloat($0) },
                minHeight: node.minHeight.map { CGFloat($0) },
                maxHeight: node.fill == true ? .infinity : node.maxHeight.map { CGFloat($0) },
                alignment: alignment
            )
            .frame(
                width: node.width.map { CGFloat($0) },
                height: node.height.map { CGFloat($0) },
                alignment: alignment
            )
    }
}

private struct XgentIOSPDFPreview: UIViewRepresentable {
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

private struct XgentIOSAVPreview: View {
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
                Label(failure, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
            } else if let player {
                if isVideo {
                    VideoPlayer(player: player)
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "waveform").font(.system(size: 52)).foregroundStyle(.secondary)
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

struct XgentIOSNode: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var expanded = false

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var children: XgentIOSNodes {
        XgentIOSNodes(nodes: node.children ?? [], document: document, model: model)
    }
    private var textBinding: Binding<String> {
        Binding(
            get: { model.value(node, in: document).text },
            set: { model.send(node, in: document, value: .string($0), editing: true) }
        )
    }
    private var boolBinding: Binding<Bool> {
        Binding(
            get: { model.value(node, in: document).boolean },
            set: { model.send(node, in: document, value: .bool($0), editing: true) }
        )
    }
    private var numberBinding: Binding<Double> {
        Binding(
            get: {
                if case .number(let value) = model.value(node, in: document) { return value }
                return node.minimum ?? 0
            },
            set: { model.send(node, in: document, value: .number($0), editing: true) }
        )
    }
    private var alignment: Alignment {
        switch node.alignment {
        case "center": return .center
        case "trailing": return .trailing
        default: return .leading
        }
    }
    private var statusColor: Color {
        switch node.status {
        case "completed": return .green
        case "error": return .red
        case "paused", "pending": return .secondary
        default: return Color(xgentHex: palette.accent)
        }
    }
    private var attributedText: AttributedString {
        (try? AttributedString(
            markdown: node.text ?? "",
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(node.text ?? "")
    }
    private var mediaData: Data? {
        let encoded = model.value(node, in: document).text
        let payload = encoded.split(separator: ",", maxSplits: 1).last.map(String.init) ?? encoded
        return Data(base64Encoded: payload, options: .ignoreUnknownCharacters)
    }

    var body: some View {
        AnyView(rendered)
            .padding(CGFloat(node.padding ?? 0))
            .padding(.leading, CGFloat(node.indent ?? 0))
            .modifier(XgentIOSNodeFrame(node: node, alignment: alignment))
            .lineLimit(node.maxLines)
            .fixedSize(horizontal: node.wrap == false, vertical: false)
            .disabled(node.disabled == true || model.isBusy(node, in: document))
            .opacity(node.disabled == true ? 0.48 : 1)
            .accessibilityIdentifier(node.id)
            .modifier(XgentIOSAccessibility(node: node))
    }

    @ViewBuilder private var rendered: some View {
        switch node.kind {
        case .vStack:
            VStack(alignment: .leading, spacing: node.spacing.map { CGFloat($0) }) { children }
        case .hStack:
            HStack(spacing: node.spacing.map { CGFloat($0) }) { children }
        case .scrollView:
            ScrollView {
                LazyVStack(alignment: .leading, spacing: CGFloat(theme.spacing.md)) { children }
            }
            .scrollDismissesKeyboard(.interactively)
        case .card:
            VStack(alignment: .leading, spacing: CGFloat(theme.spacing.md)) { children }
                .padding(CGFloat(theme.spacing.lg))
                .modifier(XgentGlassSurface())
        case .section:
            section
        case .text:
            Text(node.text ?? "")
                .font(.system(size: CGFloat(theme.typography.body * theme.fontScale)))
                .foregroundStyle(Color(xgentHex: node.secondary == true ? palette.secondaryText : palette.text))
                .textSelection(.enabled)
        case .heading:
            Text(node.text ?? node.label ?? "")
                .font(.system(size: CGFloat(theme.typography.body * theme.fontScale), weight: .semibold))
                .foregroundStyle(Color(xgentHex: palette.text))
                .accessibilityAddTraits(.isHeader)
        case .button:
            actionButton
        case .textInput:
            textInput
        case .colorInput:
            ColorPicker(node.label ?? "", selection: colorBinding, supportsOpacity: false)
                .frame(minHeight: 44)
        case .textArea:
            textArea
        case .toggle:
            Toggle(node.label ?? "", isOn: boolBinding).frame(minHeight: 44)
        case .selector:
            selector
        case .segmentedControl:
            Picker(node.label ?? "", selection: textBinding) { pickerOptions }
                .pickerStyle(.segmented)
        case .menu:
            nativeMenu
        case .divider:
            Divider()
        case .progress:
            ProgressView(node.label ?? "")
        case .progressBar:
            progressBar
        case .badge:
            Text(node.label ?? node.text ?? "")
                .font(.system(size: CGFloat(theme.typography.caption * theme.fontScale), weight: .medium))
                .foregroundStyle(statusColor)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(statusColor.opacity(0.12), in: Capsule())
        case .banner:
            banner
        case .emptyState:
            emptyState
        case .statusDot:
            HStack(spacing: 7) {
                Circle().fill(statusColor).frame(width: 8, height: 8)
                Text(node.label ?? node.text ?? "")
                    .font(.system(size: CGFloat(theme.typography.supporting * theme.fontScale)))
                    .foregroundStyle(Color(xgentHex: palette.secondaryText))
            }
        case .slider:
            slider
        case .collapsible:
            DisclosureGroup(isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 8) { children }.padding(.top, 8)
            } label: {
                Text(node.label ?? "").font(.subheadline.weight(.medium))
            }
        case .markdown:
            Text(attributedText)
                .font(.system(size: CGFloat(theme.typography.body * theme.fontScale)))
                .foregroundStyle(Color(xgentHex: palette.text))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        case .codeBlock:
            codeBlock
        case .list:
            LazyVStack(alignment: .leading, spacing: 0) { children }
        case .treeRow, .navigationRow:
            navigationRow
        case .settingsGroup:
            Section {
                children
            } header: {
                if let label = node.label, !label.isEmpty { Text(label) }
            }
        case .settingsLayout:
            VStack(alignment: .leading, spacing: CGFloat(theme.spacing.lg)) { children }
        case .iconButton:
            iconButton
        case .spacer:
            Spacer(minLength: 0)
        case .composer:
            VStack(alignment: .leading, spacing: CGFloat(theme.spacing.sm)) { children }
        case .composerInput:
            TextField(node.label ?? "", text: textBinding, axis: .vertical)
                .lineLimit(1 ... 6)
                .textFieldStyle(.plain)
                .font(.body)
                .padding(.vertical, 8)
        case .chatLayout, .browserLayout:
            VStack(spacing: 0) { children }.frame(maxWidth: .infinity, maxHeight: .infinity)
        case .chatMessage:
            chatMessage
        case .thinking:
            thinking
        case .toolCall:
            toolCall
        case .activityPreview:
            activityPreview
        case .taskProgress:
            taskProgress
        case .taskStep:
            taskStep
        case .browserViewport:
            browserViewport
        case .mediaPreview:
            mediaPreview
        case .filePicker:
            XgentAttachmentPicker(
                node: node,
                document: document,
                model: model,
                controlSize: CGFloat(theme.control.small)
            )
                .buttonStyle(.plain)
        }
    }

    @ViewBuilder private var section: some View {
        Section {
            children
        } header: {
            if let label = node.label, !label.isEmpty { Text(label) }
        }
    }

    private var actionButton: some View {
        Button(role: node.destructive == true ? .destructive : nil) {
            model.send(node, in: document)
        } label: {
            HStack(spacing: 8) {
                if model.isBusy(node, in: document) { ProgressView().controlSize(.small) }
                if let icon = node.icon { Image(systemName: icon).frame(width: 20) }
                Text(node.label ?? "").font(.body.weight(node.prominent == true ? .semibold : .regular))
            }
            .frame(minHeight: 36)
            .padding(.horizontal, 14)
            .foregroundStyle(buttonForeground)
            .background(buttonBackground, in: RoundedRectangle(
                cornerRadius: CGFloat(theme.radius.element), style: .continuous
            ))
            .contentShape(RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var buttonForeground: Color {
        if node.destructive == true { return .red }
        return node.prominent == true ? .white : Color(xgentHex: palette.text)
    }

    private var buttonBackground: Color {
        if node.prominent == true { return Color(xgentHex: palette.accent) }
        if node.destructive == true { return Color.red.opacity(0.1) }
        return Color(xgentHex: palette.muted)
    }

    @ViewBuilder private var textEntry: some View {
        if node.secure == true {
            SecureField(node.text ?? "", text: textBinding).accessibilityLabel(node.label ?? "")
        } else {
            TextField(node.text ?? "", text: textBinding).accessibilityLabel(node.label ?? "")
        }
    }

    @ViewBuilder private var textInput: some View {
        if document.mode == .sheet, !dynamicTypeSize.isAccessibilitySize {
            HStack(spacing: 12) {
                Text(node.label ?? "")
                Spacer(minLength: 12)
                textEntry
                    .textFieldStyle(.plain)
                    .multilineTextAlignment(.trailing)
                    .frame(minWidth: 100, idealWidth: 180, maxWidth: 240)
            }
            .frame(minHeight: 44)
        } else {
            VStack(alignment: .leading, spacing: 7) {
                if let label = node.label, !label.isEmpty, document.mode == .sheet {
                    Text(label).font(.subheadline).foregroundStyle(.secondary)
                }
                textEntry
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 42)
                    .background(Color(xgentHex: palette.surface), in: RoundedRectangle(
                        cornerRadius: CGFloat(theme.radius.element), style: .continuous
                    ))
                    .overlay {
                        RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                            .stroke(Color(xgentHex: palette.border), lineWidth: 1)
                    }
            }
        }
    }

    private var colorBinding: Binding<Color> {
        Binding(
            get: { Color(xgentHex: model.value(node, in: document).text) },
            set: { color in
                let resolved = UIColor(color)
                var red: CGFloat = 0
                var green: CGFloat = 0
                var blue: CGFloat = 0
                var alpha: CGFloat = 0
                guard resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return }
                let value = String(
                    format: "#%02x%02x%02x",
                    Int(red * 255), Int(green * 255), Int(blue * 255)
                )
                model.send(node, in: document, value: .string(value), editing: true)
            }
        )
    }

    private var textArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label = node.label, !label.isEmpty { Text(label).font(.subheadline) }
            TextEditor(text: textBinding)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 112)
                .padding(8)
                .background(Color(xgentHex: palette.surface), in: RoundedRectangle(
                    cornerRadius: CGFloat(theme.radius.element), style: .continuous
                ))
                .overlay {
                    RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                        .stroke(Color(xgentHex: palette.border), lineWidth: 1)
                }
        }
    }

    @ViewBuilder private var selector: some View {
        if node.variant == "compact" {
            Menu {
                ForEach(node.options ?? []) { option in
                    Button {
                        model.send(node, in: document, value: .string(option.value), editing: true)
                    } label: {
                        if option.value == textBinding.wrappedValue {
                            Label(option.label, systemImage: "checkmark")
                        } else {
                            Text(option.label)
                        }
                    }
                    .disabled(option.disabled == true)
                }
            } label: {
                HStack(spacing: 6) {
                    if let icon = node.icon { Image(systemName: icon) }
                    Text(selectedOptionLabel).lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down").font(.caption2)
                }
                .font(.subheadline.weight(.medium))
                .frame(minHeight: 32)
                .padding(.horizontal, 8)
                .background(Color(xgentHex: palette.muted), in: Capsule())
            }
            .buttonStyle(.plain)
        } else {
            Picker(node.label ?? "", selection: textBinding) { pickerOptions }
                .pickerStyle(.menu)
                .frame(minHeight: 44)
        }
    }

    private var selectedOptionLabel: String {
        node.options?.first { $0.value == textBinding.wrappedValue }?.label ?? node.label ?? ""
    }

    private var pickerOptions: some View {
        ForEach(node.options ?? []) { option in
            Text(option.label).tag(option.value).disabled(option.disabled == true)
        }
    }

    @ViewBuilder private var menuItems: some View {
        ForEach(node.children ?? []) { child in
            if child.kind == .divider {
                Divider()
            } else {
                Button(role: child.destructive == true ? .destructive : nil) {
                    model.send(child, in: document)
                } label: {
                    if let icon = child.icon { Label(child.label ?? "", systemImage: icon) }
                    else { Text(child.label ?? child.text ?? "") }
                }
                .disabled(child.disabled == true)
            }
        }
    }

    @ViewBuilder private var nativeMenu: some View {
        Menu { menuItems } label: {
            if node.id == "tools" {
                Image(systemName: node.icon ?? "ellipsis")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Color(xgentHex: palette.text))
            } else {
                nodeLabel
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(node.label ?? "")
    }

    @ViewBuilder private var nodeLabel: some View {
        if let icon = node.icon { Label(node.label ?? "", systemImage: icon) }
        else { Text(node.label ?? "") }
    }

    private var progressBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(node.label ?? "").font(.subheadline)
                Spacer()
                if let current = node.current, let total = node.total {
                    Text("\(Int(current))/\(Int(total))")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            ProgressView(value: node.current ?? 0, total: max(node.total ?? 1, 1)).tint(statusColor)
        }
    }

    private var banner: some View {
        HStack(alignment: .top, spacing: CGFloat(theme.spacing.sm)) {
            statusIcon
            VStack(alignment: .leading, spacing: 4) {
                if let label = node.label, !label.isEmpty { Text(label).font(.headline) }
                if let text = node.text, !text.isEmpty {
                    Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                children
            }
        }
        .padding(CGFloat(theme.spacing.md))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(statusColor.opacity(0.1), in: RoundedRectangle(
            cornerRadius: CGFloat(theme.radius.element), style: .continuous
        ))
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: node.icon ?? "tray")
                .font(.system(size: 28))
                .foregroundStyle(Color(xgentHex: palette.secondaryText))
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

    private var slider: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(node.label ?? "")
                Spacer()
                Text(numberBinding.wrappedValue.formatted()).foregroundStyle(.secondary)
            }
            Slider(
                value: numberBinding,
                in: (node.minimum ?? 0) ... (node.maximum ?? 1),
                step: node.step ?? 0.1
            )
        }
        .frame(minHeight: 44)
    }

    private var codeBlock: some View {
        ScrollView(.horizontal) {
            Text(node.text ?? "")
                .font(.system(
                    size: CGFloat(theme.typography.supporting * theme.fontScale), design: .monospaced
                ))
                .foregroundStyle(Color(xgentHex: palette.text))
                .textSelection(.enabled)
                .padding(CGFloat(theme.spacing.md))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(xgentHex: palette.background), in: RoundedRectangle(
            cornerRadius: CGFloat(theme.radius.element), style: .continuous
        ))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
    }

    private var navigationRow: some View {
        Button { model.send(node, in: document) } label: {
            HStack(spacing: 12) {
                if let icon = node.icon {
                    Image(systemName: icon).font(.system(size: 19)).frame(width: 24)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(node.label ?? "").foregroundStyle(Color(xgentHex: palette.text))
                    if let text = node.text, !text.isEmpty {
                        Text(text).font(.subheadline).foregroundStyle(Color(xgentHex: palette.secondaryText))
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                if node.selected == true {
                    Image(systemName: "checkmark").foregroundStyle(.tint)
                } else if node.action != nil {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var iconButton: some View {
        Button { model.send(node, in: document) } label: {
            Group {
                if node.icon == "xgent.sidebar" { XgentIOSSidebarGlyph() }
                else { Image(systemName: node.icon ?? "ellipsis").font(.system(size: 18, weight: .medium)) }
            }
            .frame(width: iconControlSize, height: iconControlSize)
            .foregroundStyle(node.prominent == true ? Color.white : Color(xgentHex: palette.text))
            .background(
                node.prominent == true ? Color(xgentHex: palette.accent) : Color.clear,
                in: Circle()
            )
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(node.label ?? "")
    }

    private var iconControlSize: CGFloat {
        if node.id == "sidebar" || node.id == "tools" { return CGFloat(theme.control.large) }
        return CGFloat(theme.control.small)
    }

    @ViewBuilder private var chatMessage: some View {
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
                        Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    children
                }
                .padding(node.role == "user" ? 12 : 0)
                .background {
                    if node.role == "user" {
                        RoundedRectangle(cornerRadius: CGFloat(theme.radius.chat), style: .continuous)
                            .fill(Color(xgentHex: palette.accent).opacity(colorScheme == .dark ? 0.22 : 0.12))
                    }
                }
                if node.role != "user" { Spacer(minLength: 0) }
            }
            .frame(maxWidth: .infinity, alignment: node.role == "user" ? .trailing : .leading)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(node.role == "user" ? "You" : "Assistant")
        }
    }

    private var thinking: some View {
        DisclosureGroup(isExpanded: $expanded) {
            Text(attributedText)
                .font(.system(size: CGFloat(theme.typography.supporting * theme.fontScale)))
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

    private var toolCall: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) { children }.padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                statusIcon
                Text(node.label ?? "Tool").font(.system(.subheadline, design: .monospaced).weight(.medium))
                if let text = node.text, !text.isEmpty {
                    Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
            }
        }
        .padding(10)
        .background(Color(xgentHex: palette.surface).opacity(0.72), in: RoundedRectangle(
            cornerRadius: CGFloat(theme.radius.element), style: .continuous
        ))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
    }

    private var activityPreview: some View {
        Button { model.send(node, in: document) } label: {
            ZStack {
                if let data = mediaData, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Color(xgentHex: palette.surface).opacity(0.78)
                    VStack(spacing: 5) {
                        Image(systemName: node.icon ?? "hammer").font(.system(size: 19, weight: .medium))
                        Text(node.label ?? "Activity").font(.caption2.weight(.medium)).lineLimit(1)
                    }
                }
                if node.status == "running" {
                    ProgressView().controlSize(.small)
                        .padding(6).background(.regularMaterial, in: Circle())
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                        .padding(5)
                }
            }
            .frame(width: 100, height: 65)
            .clipShape(RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous))
        }
        .buttonStyle(.plain)
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
    }

    private var taskProgress: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 9) { children }.padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                statusIcon
                Text(node.label ?? "Tasks").lineLimit(1)
                Spacer(minLength: 8)
                if let current = node.current, let total = node.total {
                    Text("\(Int(current))/\(Int(total))")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .font(.system(size: CGFloat(theme.typography.supporting * theme.fontScale)))
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(Color(xgentHex: palette.surface).opacity(0.78), in: RoundedRectangle(
            cornerRadius: CGFloat(theme.radius.element), style: .continuous
        ))
        .overlay {
            RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                .stroke(Color(xgentHex: palette.border), lineWidth: 1)
        }
    }

    private var taskStep: some View {
        HStack(alignment: .top, spacing: 9) {
            statusIcon
            VStack(alignment: .leading, spacing: 2) {
                Text(node.label ?? "").font(.subheadline.weight(node.status == "running" ? .semibold : .regular))
                if let text = node.text, !text.isEmpty {
                    Text(text).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private var statusIcon: some View {
        switch node.status {
        case "completed": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case "error": Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
        case "running": ProgressView().controlSize(.small)
        case "paused": Image(systemName: "pause.circle").foregroundStyle(.secondary)
        default: Image(systemName: "circle").foregroundStyle(.secondary)
        }
    }

    private var browserViewport: some View {
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

    private func reportBrowserViewport(_ rect: CGRect, visible: Bool) {
        guard rect.origin.x.isFinite, rect.origin.y.isFinite,
              rect.width.isFinite, rect.height.isFinite else { return }
        let payload = String(
            format: "{\"x\":%.3f,\"y\":%.3f,\"width\":%.3f,\"height\":%.3f,\"visible\":%@,\"scaleFactor\":1}",
            rect.origin.x, rect.origin.y, max(rect.width, 1), max(rect.height, 1), visible ? "true" : "false"
        )
        model.send(node, in: document, value: .string(payload), editing: true)
    }

    @ViewBuilder private var mediaPreview: some View {
        if let data = mediaData, let mimeType = node.language,
           mimeType.hasPrefix("audio/") || mimeType.hasPrefix("video/") {
            XgentIOSAVPreview(data: data, mimeType: mimeType, label: node.label ?? "Media preview")
        } else if let data = mediaData, node.language == "application/pdf" {
            XgentIOSPDFPreview(data: data)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(node.label ?? "PDF document")
        } else if let data = mediaData, let image = UIImage(data: data) {
            ScrollView([.horizontal, .vertical]) {
                Image(uiImage: image).resizable().scaledToFit()
                    .accessibilityLabel(node.label ?? "Image preview")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Label(node.label ?? "No preview", systemImage: "doc.questionmark")
                .foregroundStyle(Color(xgentHex: palette.secondaryText))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct XgentIOSSidebarGlyph: View {
    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 3, y: 7))
            path.addLine(to: CGPoint(x: 21, y: 7))
            path.move(to: CGPoint(x: 3, y: 17))
            path.addLine(to: CGPoint(x: 15, y: 17))
        }
        .stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round))
        .frame(width: 24, height: 24)
    }
}
#endif
