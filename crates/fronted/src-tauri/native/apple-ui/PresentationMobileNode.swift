#if os(iOS)
import AVKit
import Foundation
import PDFKit
import SwiftUI
import SwiftUIIntrospect
import UIKit

private struct XgentIOSFormRowKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var xgentIOSFormRow: Bool {
        get { self[XgentIOSFormRowKey.self] }
        set { self[XgentIOSFormRowKey.self] = newValue }
    }
}

// iOS has a deliberately handwritten presentation layer. The wire nodes below
// carry state and actions only; no generated Astryx-to-SwiftUI renderer is used.
struct XgentIOSNodes: View {
    let nodes: [XgentNode]
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    var parentAxis: Axis? = nil

    var body: some View {
        ForEach(nodes) { node in
            XgentIOSNode(node: node, document: document, model: model, parentAxis: parentAxis)
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
    let parentAxis: Axis?

    private var fillsHeight: Bool {
        node.fill == true && parentAxis != .horizontal
    }

    func body(content: Content) -> some View {
        content
            .frame(
                minWidth: node.minWidth.map { CGFloat($0) },
                maxWidth: node.fill == true ? .infinity : node.maxWidth.map { CGFloat($0) },
                minHeight: node.minHeight.map { CGFloat($0) },
                // Astryx StackItem `fill` grows along the available layout
                // axis. A field inside an HStack must not also claim infinite
                // height (that was stretching browser/file toolbars to half
                // the screen).
                maxHeight: fillsHeight ? .infinity : node.maxHeight.map { CGFloat($0) },
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
    var parentAxis: Axis? = nil
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.xgentIOSFormRow) private var isFormRow
    @ScaledMetric(relativeTo: .body) private var bodyScale = 1.0
    @ScaledMetric(relativeTo: .subheadline) private var supportingScale = 1.0
    @ScaledMetric(relativeTo: .caption) private var captionScale = 1.0
    @State private var expanded: Bool
    @State private var pickingModel = false

    init(node: XgentNode, document: XgentDocument, model: XgentPresentationModel,
         parentAxis: Axis? = nil) {
        self.node = node
        self.document = document
        self.model = model
        self.parentAxis = parentAxis
        _expanded = State(initialValue: node.variant == "timeline" ||
                          (node.kind == .thinking && node.status == "running"))
    }

    private var palette: XgentPalette { theme.palette(for: colorScheme) }
    private var childAxis: Axis? {
        switch node.kind {
        case .hStack: return .horizontal
        case .vStack, .scrollView, .list, .settingsGroup, .settingsLayout,
             .chatLayout, .browserLayout, .composer, .card, .section:
            return .vertical
        default: return nil
        }
    }
    private var children: XgentIOSNodes {
        XgentIOSNodes(nodes: node.children ?? [], document: document, model: model,
                      parentAxis: childAxis)
    }
    private var textBinding: Binding<String> {
        Binding(
            get: { model.value(node, in: document).text },
            set: { model.send(node, in: document, value: .string($0), editing: true) }
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

    @ViewBuilder private var identified: some View {
        switch node.kind {
        case .textInput, .colorInput:
            rendered
        case .navigationRow where node.variant == "sidebar-conversation-row" || node.variant == "sidebar-workspace-row":
            rendered
        case .collapsible where node.variant == "memory-project":
            rendered.accessibilityElement(children: .contain)
        case .selector where node.variant == "workspace-file-sheets":
            rendered.accessibilityElement(children: .contain)
        case .numberInput where node.variant == "document-annotation-page":
            rendered.accessibilityElement(children: .contain)
        case .mediaPreview where node.variant == "workspace-image-preview":
            rendered.accessibilityElement(children: .contain)
        case .vStack, .hStack, .scrollView, .card, .section, .list,
             .settingsGroup, .settingsLayout, .composer, .chatLayout,
             .browserLayout, .chatMessage, .spreadsheetGrid, .terminalToolbar:
            // Container identifiers propagate to descendants in SwiftUI.
            // Keep each actionable child addressable in the live AX hierarchy.
            rendered.accessibilityElement(children: .contain)
        default:
            rendered.accessibilityIdentifier(node.id)
        }
    }

    var body: some View {
        AnyView(identified)
            .padding(CGFloat(node.padding ?? 0))
            .padding(.leading, CGFloat(node.indent ?? 0))
            .modifier(XgentIOSNodeFrame(node: node, alignment: alignment, parentAxis: parentAxis))
            .lineLimit(node.maxLines)
            .fixedSize(horizontal: node.wrap == false, vertical: false)
            .disabled(node.disabled == true || model.isBusy(node, in: document))
            .opacity(node.disabled == true && node.kind != .button && node.kind != .iconButton ? 0.48 : 1)
            .modifier(XgentIOSAccessibility(node: node))
    }

    @ViewBuilder private var rendered: some View {
        switch node.kind {
        case .vStack:
            if node.variant == "workspace-editor-tabs" {
                XgentWorkspaceEditorTabs(node: node, document: document, model: model)
            } else if node.variant == "workspace-editor-close-all" {
                XgentWorkspaceCloseAll(node: node, document: document, model: model).id(node.id)
            } else if node.variant == "workspace-editor-run-output" {
                XgentWorkspaceRunOutput(node: node, document: document, model: model)
                    .id(node.value?.text ?? node.id)
            } else if node.variant == "workspace-file-annotations" {
                XgentDocumentAnnotationsEditor(node: node, document: document, model: model)
            } else if node.variant == "workspace-file-layout" {
                XgentWorkspaceFileLayout(node: node, document: document, model: model)
            } else if node.variant == "terminal-rename-editor" {
                XgentTerminalRenameEditor(node: node, document: document, model: model)
            } else if node.variant == "browser-navigation" {
                XgentBrowserNavigation(node: node, document: document, model: model)
            } else if node.variant == "browser-tabs" {
                XgentBrowserTabs(node: node, document: document, model: model)
            } else if node.variant == "browser-header" {
                XgentBrowserHeader(node: node, document: document, model: model)
            } else if node.variant == "browser-error" {
                XgentBrowserError(node: node, document: document, model: model)
            } else if node.variant == "browser-address-entry" || node.variant == "browser-home-row" {
                XgentBrowserAddressEntry(node: node, document: document, model: model)
            } else if node.variant == "skills-hub-layout" {
                XgentSkillsHubLayout(node: node, document: document, model: model)
            } else if node.variant == "skills-hub-main" {
                XgentSkillsHubMain(node: node, document: document, model: model)
            } else if node.variant == "skills-hub-toolbar" {
                XgentSkillsHubToolbar(node: node, document: document, model: model)
            } else if node.variant == "skill-hub-controls" || node.variant == "skill-bulk-actions" {
                XgentSkillHubControls(node: node, document: document, model: model)
            } else if node.variant == "skill-installed-row" || node.variant == "skill-store-card" {
                XgentSkillRow(node: node, document: document, model: model)
            } else if node.variant == "skill-row-actions" {
                XgentSkillRowActions(node: node, document: document, model: model)
            } else if node.variant == "skill-tags" {
                XgentSkillTags(node: node, document: document, model: model)
            } else if node.variant == "skill-store-grid" {
                XgentSkillStoreGrid(node: node, document: document, model: model)
            } else if node.variant == "skill-preview" {
                XgentSkillPreview(node: node, document: document, model: model)
            } else if node.variant == "skill-detail-value" {
                XgentSkillDetailValue(node: node)
            } else if node.variant == "skill-import-row" {
                XgentSkillImportRow(node: node, document: document, model: model)
            } else if node.variant == "mcp-server-editor" {
                XgentMCPServerEditor(node: node, document: document, model: model)
            } else if node.variant == "mcp-connection-fields" {
                XgentMCPConnectionFields(node: node, document: document, model: model)
            } else if node.variant == "mcp-editor-footer" {
                XgentMCPEditorFooter(node: node, document: document, model: model)
            } else if node.variant == "mcp-server-row" {
                XgentMCPServerRow(node: node, document: document, model: model)
            } else if node.variant == "mcp-server-metadata" {
                XgentMCPMetadata(node: node, document: document, model: model)
            } else if node.variant == "mcp-server-actions" {
                XgentMCPServerActions(node: node, document: document, model: model)
            } else if node.variant == "mcp-import-row" {
                XgentMCPImportRow(node: node, document: document, model: model)
            } else if node.variant == "question-card" {
                XgentQuestionCard(node: node, document: document, model: model)
            } else if node.variant == "question-footer" {
                XgentQuestionFooter(node: node, document: document, model: model)
            } else if node.variant == "tool-policy-row" {
                XgentToolPolicyRow(node: node, document: document, model: model)
            } else if node.variant == "tool-category-actions" {
                XgentToolCategoryActions(node: node, document: document, model: model)
            } else if node.variant == "tool-policy-help" {
                XgentToolPolicyHelp(node: node)
            } else if node.variant == "voice-credentials" {
                XgentVoiceCredentials(node: node, document: document, model: model)
            } else if node.variant == "cron-detail-layout" {
                XgentCronDetailLayout(node: node, document: document, model: model)
            } else if node.variant == "cron-detail-value" {
                XgentCronDetailValue(node: node)
            } else if node.variant == "cron-run-row" {
                XgentCronRunRow(node: node, document: document, model: model)
            } else if node.variant == "backup-connection-fields" {
                XgentBackupConnectionFields(node: node, document: document, model: model)
            } else if node.variant == "backup-transfer-actions" {
                XgentBackupTransferActions(node: node, document: document, model: model)
            } else if node.variant == "automation-row" {
                XgentAutomationRow(node: node, document: document, model: model)
            } else if node.variant == "hook-lifecycle" {
                XgentHookLifecycle(node: node)
            } else if node.variant == "http-request-editor" {
                XgentHTTPRequestEditorRow(node: node, document: document, model: model)
            } else if node.variant == "http-request-fields" || node.variant == "http-request-address" {
                XgentHTTPRequestFields(node: node, document: document, model: model)
            } else if node.variant == "provider-model-row" {
                XgentProviderModelRow(node: node, document: document, model: model)
            } else if node.variant == "provider-import-row" {
                XgentProviderImportRow(node: node, document: document, model: model)
            } else {
                VStack(alignment: .leading, spacing: node.spacing.map { CGFloat($0) }) { children }
            }
        case .hStack:
            if node.variant == "sidebar-section-heading" {
                XgentSidebarSectionHeading(node: node, document: document, model: model)
            } else if node.variant == "workspace-file-metadata" {
                XgentWorkspaceFileMetadata(node: node, document: document, model: model)
            } else { XgentHorizontalControls(node: node) { children } }
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
                .font(XgentFonts.body(theme.fontFamily, size: CGFloat((node.secondary == true ? 15 : 17) * theme.fontScale * bodyScale)))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(Color(xgentHex: node.secondary == true ? palette.secondaryText : palette.text))
                .textSelection(.enabled)
        case .heading:
            HStack(spacing: 8) {
                if let icon = node.icon {
                    Image(systemName: icon).foregroundStyle(Color(xgentHex: palette.accent))
                }
                Text(node.text ?? node.label ?? "")
                    .lineLimit(node.maxLines)
            }
            .font(XgentFonts.body(theme.fontFamily, size: CGFloat(17 * theme.fontScale * bodyScale), weight: .semibold))
            .foregroundStyle(Color(xgentHex: palette.text))
            .accessibilityAddTraits(.isHeader)
        case .button:
            if node.variant == "workspace-source-action" {
                XgentWorkspaceSourceAction(node: node, document: document, model: model)
            } else if node.variant == "workspace-editor-bulk-action" {
                XgentWorkspaceBulkAction(node: node, document: document, model: model)
            } else if node.variant == "workspace-image-save" {
                XgentWorkspaceImageSaveButton(node: node, document: document, model: model)
            } else if node.variant == "workspace-file-save" {
                XgentWorkspaceFileSaveButton(node: node, document: document, model: model)
            } else if node.variant == "question-option" {
                XgentQuestionOptionButton(node: node, document: document, model: model)
            } else { actionButton }
        case .textInput:
            textInput
        case .shortcutRecorder:
            Text(node.text ?? "").foregroundStyle(.secondary)
        case .colorInput:
            XgentColorInput(node: node, document: document, model: model)
        case .timeInput:
            XgentTimeInput(node: node, document: document, model: model)
        case .textArea:
            if node.variant == "document-annotation" {
                XgentDocumentAnnotationText(node: node, document: document, model: model)
            } else { textArea }
        case .toggle:
            XgentSwitch(node: node, document: document, model: model)
        case .selector:
            if node.variant == "workspace-file-sheets" {
                XgentSpreadsheetSheets(node: node, document: document, model: model)
            } else if node.variant == "terminal-session-tabs" {
                XgentTerminalSessionTabs(node: node, document: document, model: model)
            } else { selector }
        case .segmentedControl:
            XgentSegmentedControl(node: node, document: document, model: model)
        case .menu:
            if node.variant == "workspace-file-open" {
                XgentWorkspaceFileOpenMenu(node: node, document: document, model: model)
            } else { nativeMenu }
        case .divider:
            Divider()
        case .progress:
            ProgressView(node.label ?? "")
        case .progressBar:
            if node.variant == "context-usage" {
                XgentContextUsage(node: node, document: document, model: model)
            } else { progressBar }
        case .badge:
            Text(node.label ?? node.text ?? "")
                .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.caption * theme.fontScale * captionScale), weight: .medium))
                .foregroundStyle(statusColor)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(statusColor.opacity(0.12), in: Capsule())
        case .banner:
            if node.variant == "error-screen" {
                XgentErrorScreen(node: node, document: document, model: model)
            } else {
                banner
            }
        case .emptyState:
            emptyState
        case .statusDot:
            HStack(spacing: 7) {
                Circle().fill(statusColor).frame(width: 8, height: 8)
                Text(node.label ?? node.text ?? "")
                    .font(XgentFonts.body(theme.fontFamily, size: CGFloat(theme.typography.supporting * theme.fontScale * supportingScale)))
                    .foregroundStyle(Color(xgentHex: palette.secondaryText))
            }
        case .slider:
            XgentSlider(node: node, document: document, model: model)
        case .numberInput:
            if node.variant == "workspace-image-rotation" {
                XgentImageRotationButton(node: node, document: document, model: model)
            } else if node.variant == "document-annotation-page" {
                XgentDocumentAnnotationPage(node: node, document: document, model: model)
            } else { XgentNumberInput(node: node, document: document, model: model) }
        case .collapsible:
            XgentDisclosure(node: node, document: document, model: model)
                .id(node.value?.text ?? node.id)
        case .markdown:
            XgentMarkdown(text: node.text ?? "", codeConfiguration: .decode(node.value?.text, fallback: .markdown),
                          highlightCode: { source, language in await model.highlightCode(node, in: document, source: source, language: language) },
                          renderDiagram: { source, dark in await model.renderDiagram(node, in: document, source: source, dark: dark) })
        case .codeBlock:
            codeBlock
        case .list:
            if node.variant == "composer-suggestions" {
                XgentComposerSuggestions(node: node, document: document, model: model)
            } else { list }
        case .providerList:
            XgentProviderListView(node: node, document: document, model: model)
        case .treeRow, .navigationRow:
            if node.variant == "memory-entry" {
                XgentMemoryEntry(node: node, document: document, model: model)
            } else if node.variant == "sidebar-conversation-row" || node.variant == "sidebar-workspace-row" {
                XgentSidebarConversationRow(node: node, document: document, model: model)
            } else if isFormRow {
                XgentSettingsNavigationRow(node: node, document: document, model: model)
            } else { navigationRow }
        case .settingsGroup:
            settingsGroup
        case .settingsLayout:
            VStack(alignment: .leading, spacing: CGFloat(theme.spacing.lg)) { children }
        case .iconButton:
            iconButton
        case .spacer:
            Spacer(minLength: 0)
        case .composer:
            VStack(alignment: .leading, spacing: CGFloat(theme.spacing.sm)) { children }
        case .composerInput:
            XgentComposerInput(node: node, document: document, model: model)
        case .browserLayout:
            XgentBrowserLayout(node: node, document: document, model: model)
        case .chatLayout:
            VStack(spacing: 0) { children }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .chatMessage:
            chatMessage
        case .thinking:
            thinking
        case .toolCall:
            toolCall
        case .activityPreview:
            activityPreview
        case .taskProgress:
            XgentTaskProgressChip(node: node, document: document, model: model)
        case .taskStep:
            XgentTaskProgressStep(node: node)
        case .browserViewport:
            browserViewport
        case .terminalLayout:
            XgentTerminalLayout(node: node, document: document, model: model)
        case .terminalToolbar:
            XgentTerminalToolbar(node: node, document: document, model: model)
        case .terminalViewport:
            XgentTerminalViewport(node: node, document: document, model: model)
        case .mediaPreview:
            if node.variant == "workspace-image-preview" {
                XgentWorkspaceImagePreview(node: node, document: document, model: model)
            } else { mediaPreview }
        case .spreadsheetGrid:
            XgentSpreadsheetGrid(node: node, document: document, model: model)
        case .htmlPreview:
            XgentHTMLPreview(source: node.text ?? "", encoded: node.value?.text ?? "", label: node.label ?? "HTML preview")
        case .filePicker:
            if node.variant == "skill-bundle" {
                XgentSkillBundlePicker(node: node, document: document, model: model)
            } else {
                XgentAttachmentPicker(
                    node: node,
                    document: document,
                    model: model,
                    controlSize: max(44, CGFloat(theme.control.small))
                )
                    .id(node.action)
                    .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private var section: some View {
        Section {
            children
        } header: {
            if let label = node.label, !label.isEmpty { Text(label) }
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array((node.children ?? []).enumerated()), id: \.element.id) { index, child in
                if index > 0 {
                    Divider()
                        .padding(.leading, child.icon == nil ? 12 : 48)
                        .overlay(Color(xgentHex: palette.border))
                }
                XgentIOSNode(node: child, document: document, model: model, parentAxis: .vertical)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var settingsGroup: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label = node.label, !label.isEmpty {
                Text(label)
                    .font(.system(size: CGFloat(theme.typography.supporting * theme.fontScale * supportingScale),
                                  weight: .semibold))
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
                    XgentIOSNode(node: child, document: document, model: model,
                                 parentAxis: .vertical)
                        .padding(.vertical, 6)
                }
            }
            .padding(.horizontal, 12)
            .background(Color(xgentHex: palette.card), in: RoundedRectangle(
                cornerRadius: CGFloat(theme.radius.container), style: .continuous
            ))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actionButton: some View {
        XgentActionButton(node: node, document: document, model: model)
    }

    private var textInput: some View {
        XgentTextInput(node: node, document: document, model: model)
    }

    private var textArea: some View {
        XgentTextArea(node: node, document: document, model: model)
    }

    @ViewBuilder private var selector: some View {
        if node.id == "model" {
            Button { pickingModel = true } label: {
                HStack(spacing: 6) {
                    if let icon = node.icon { Image(systemName: icon) }
                    Text(node.options?.first { $0.value == textBinding.wrappedValue }?.displayLabel
                         ?? node.label ?? "")
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Image(systemName: "chevron.down").font(.caption2)
                }
                .font(.subheadline.weight(.medium))
                .frame(minWidth: 120, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(node.label ?? "Model")
            .accessibilityValue(selectedOptionLabel)
            .sheet(isPresented: $pickingModel) {
                XgentIOSModelPicker(node: node, document: document, model: model)
            }
        } else {
            XgentSelector(node: node, document: document, model: model)
        }
    }

    private var selectedOptionLabel: String {
        node.options?.first { $0.value == textBinding.wrappedValue }?.label ?? node.label ?? ""
    }

    private var nativeMenu: some View {
        XgentNativeMenu(node: node, document: document, model: model)
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

    private var codeBlock: some View {
        XgentCodeBlock(text: node.text ?? "", language: node.language, label: node.label,
                       configuration: .decode(node.value?.text, fallback: .plain),
                       highlightCode: { source, language in await model.highlightCode(node, in: document, source: source, language: language) })
    }

    private var navigationRow: some View {
        Button { model.send(node, in: document) } label: {
            HStack(spacing: 12) {
                if let icon = node.icon {
                    Image(systemName: icon).font(.system(size: 19)).frame(width: 24)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(node.label ?? "").foregroundStyle(Color(xgentHex: palette.text))
                        .fixedSize(horizontal: false, vertical: true)
                    if let text = node.text, !text.isEmpty {
                        Text(text).font(.subheadline).foregroundStyle(Color(xgentHex: palette.secondaryText))
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                if node.selected == true && node.variant == "sidebar-conversation" {
                    Circle().fill(Color(xgentHex: palette.accent)).frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                } else if node.selected == true {
                    Image(systemName: "checkmark").foregroundStyle(.tint)
                } else if node.action != nil && node.variant != "sidebar"
                            && node.variant != "sidebar-conversation" {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity,
                   minHeight: node.variant == "sidebar" || node.variant == "sidebar-conversation" || isFormRow ? 44 : 56,
                   alignment: .leading)
            .padding(.horizontal, isFormRow ? 0 : (node.variant == "sidebar" || node.variant == "sidebar-conversation" ? 8 : 12))
            .background(
                node.selected == true && node.variant != "sidebar-conversation"
                    ? Color(xgentHex: palette.muted) : Color.clear,
                in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .modifier(XgentControlTypography(node: node))
        .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
        .accessibilityHint(node.accessibilityHint ?? node.text ?? "")
        .accessibilityAddTraits(node.selected == true ? .isSelected : [])
    }

    private var iconButton: some View {
        XgentIconButton(node: node, document: document, model: model)
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
                .font(.system(size: CGFloat(theme.typography.supporting * theme.fontScale * supportingScale)))
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
        Group {
            if node.variant == "timeline" || node.status == "running" {
                VStack(alignment: .leading, spacing: 8) {
                    toolCallLabel
                    toolCallContent
                }
            } else {
                DisclosureGroup(isExpanded: $expanded) {
                    toolCallContent
                } label: {
                    toolCallLabel
                }
            }
        }
        .tint(Color(xgentHex: palette.secondaryText))
        .padding(node.variant == "timeline" ? 2 : 10)
        .background {
            if node.variant != "timeline" {
                RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                    .fill(Color(xgentHex: palette.surface).opacity(0.72))
            }
        }
        .overlay {
            if node.variant != "timeline" {
                RoundedRectangle(cornerRadius: CGFloat(theme.radius.element), style: .continuous)
                    .stroke(Color(xgentHex: palette.border), lineWidth: 1)
            }
        }
    }

    private var toolCallContent: some View {
        VStack(alignment: .leading, spacing: 8) { children }.padding(.top, 8)
    }

    private var toolCallLabel: some View {
        XgentToolCallHeader(node: node)
    }

    private var activityPreview: some View {
        Button { model.send(node, in: document) } label: {
            ZStack {
                XgentDataImage(encoded: model.value(node, in: document).text, maximumPixelSize: 300,
                               contentMode: .fill, label: node.label ?? "Activity") {
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
                .onDisappear { reportBrowserViewport(proxy.frame(in: .global), visible: false) }
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
        if let mimeType = node.language,
           mimeType.hasPrefix("audio/") || mimeType.hasPrefix("video/"), let data = mediaData {
            XgentIOSAVPreview(data: data, mimeType: mimeType, label: node.label ?? "Media preview")
        } else if node.language == "application/pdf", let data = mediaData {
            XgentIOSPDFPreview(data: data)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(node.label ?? "PDF document")
        } else if let mimeType = node.language,
                  !mimeType.hasPrefix("image/"), let data = mediaData {
            XgentQuickLookPreview(data: data, mimeType: mimeType, label: node.label ?? "Document")
        } else if !model.value(node, in: document).text.isEmpty {
            XgentImagePreview(encoded: model.value(node, in: document).text,
                              label: node.label ?? "Image preview")
        } else {
            Label(node.label ?? "No preview", systemImage: "doc.questionmark")
                .foregroundStyle(Color(xgentHex: palette.secondaryText))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

#endif
