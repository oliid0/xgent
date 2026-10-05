import SwiftUI

// Handwritten desktop compositions. The shared document supplies business state
// and action identifiers; it does not select Astryx components or SwiftUI styles.
extension XgentNodeView {
    @ViewBuilder var desktopContent: some View {
        switch node.kind {
        case .vStack:
            if node.variant == "other-settings-area" {
                XgentOtherSettingsArea(node: node, document: document, model: model)
            } else if node.variant == "workspace-search-palette" {
                XgentWorkspaceSearchPalette(node: node, document: document, model: model)
            } else if node.variant == "workspace-editor-tabs" {
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
            } else if node.variant == "ssh-host-row" {
                XgentSSHHostRow(node: node, document: document, model: model)
            } else if node.variant == "automation-row" {
                XgentAutomationRow(node: node, document: document, model: model)
            } else if node.variant == "hook-lifecycle" {
                XgentHookLifecycle(node: node)
            } else if node.variant == "http-request-editor" {
                XgentHTTPRequestEditorRow(node: node, document: document, model: model)
            } else if node.variant == "http-request-fields" || node.variant == "http-request-address" {
                XgentHTTPRequestFields(node: node, document: document, model: model)
            } else if node.variant == "computer-use-permission" {
                XgentComputerUsePermissionRow(node: node, document: document, model: model)
            } else if node.variant == "provider-model-row" {
                XgentProviderModelRow(node: node, document: document, model: model)
            } else if node.variant == "provider-import-row" {
                XgentProviderImportRow(node: node, document: document, model: model)
            } else {
                #if os(macOS)
                if node.id == "desktop-git-layout" {
                    XgentDesktopGitLayout(node: node, document: document, model: model)
                } else {
                    VStack(alignment: .leading, spacing: node.spacing.map { CGFloat($0) }) { children }
                }
                #else
                VStack(alignment: .leading, spacing: node.spacing.map { CGFloat($0) }) { children }
                #endif
            }
        case .hStack:
            if node.variant == "sidebar-section-heading" {
                XgentSidebarSectionHeading(node: node, document: document, model: model)
            } else if node.variant == "workspace-file-metadata" {
                XgentWorkspaceFileMetadata(node: node, document: document, model: model)
            } else { XgentHorizontalControls(node: node) { children } }
        case .scrollView:
            ScrollView { LazyVStack(alignment: .leading, spacing: CGFloat(presentationTheme.spacing.md)) { children } }
        case .card:
            XgentDesktopSettingsCard(node: node, document: document, model: model)
        case .settingsGroup:
            #if os(macOS)
            if node.id == "computer-use-permissions" {
                XgentComputerUsePermissionsCard(node: node, document: document, model: model)
            } else { XgentDesktopSettingsCard(node: node, document: document, model: model) }
            #else
            XgentDesktopSettingsCard(node: node, document: document, model: model)
            #endif
        case .section:
            VStack(alignment: .leading, spacing: CGFloat(presentationTheme.spacing.md)) {
                if let label = node.label, !label.isEmpty {
                    Text(label).modifier(XgentControlTypography(node: node)).fontWeight(.semibold)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                children
            }
        case .settingsLayout:
            XgentDesktopSettingsLayout(node: node, document: document, model: model)
        case .text:
            nativeText
        case .heading:
            nativeHeading
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
            } else {
                #if os(macOS)
                if node.variant == "shortcut-binding" {
                    XgentShortcutBindingButton(node: node, document: document, model: model)
                } else { XgentActionButton(node: node, document: document, model: model) }
                #else
                XgentActionButton(node: node, document: document, model: model)
                #endif
            }
        case .iconButton:
            XgentIconButton(node: node, document: document, model: model)
        case .textInput:
            XgentTextInput(node: node, document: document, model: model)
        case .shortcutRecorder:
            #if os(macOS)
            XgentShortcutRecorder(node: node, document: document, model: model)
            #else
            Text(node.text ?? "").foregroundStyle(.secondary)
            #endif
        case .textArea:
            if node.variant == "document-annotation" {
                XgentDocumentAnnotationText(node: node, document: document, model: model)
            } else { nativeTextArea }
        case .numberInput:
            if node.variant == "workspace-image-rotation" {
                XgentImageRotationButton(node: node, document: document, model: model)
            } else if node.variant == "document-annotation-page" {
                XgentDocumentAnnotationPage(node: node, document: document, model: model)
            } else { XgentNumberInput(node: node, document: document, model: model) }
        case .timeInput:
            XgentTimeInput(node: node, document: document, model: model)
        case .colorInput:
            nativeColorInput.modifier(XgentControlTypography(node: node))
        case .toggle:
            XgentSwitch(node: node, document: document, model: model)
        case .selector:
            if node.variant == "workspace-file-sheets" {
                XgentSpreadsheetSheets(node: node, document: document, model: model)
            } else if node.variant == "terminal-session-tabs" {
                XgentTerminalSessionTabs(node: node, document: document, model: model)
            } else { XgentSelector(node: node, document: document, model: model) }
        case .segmentedControl:
            XgentSegmentedControl(node: node, document: document, model: model)
        case .menu:
            if node.variant == "workspace-file-open" {
                XgentWorkspaceFileOpenMenu(node: node, document: document, model: model)
            } else { XgentNativeMenu(node: node, document: document, model: model) }
        case .slider:
            XgentSlider(node: node, document: document, model: model)
        case .divider:
            Divider()
        case .spacer:
            Spacer(minLength: 0)
        case .progress:
            ProgressView(node.label ?? "").modifier(XgentControlTypography(node: node))
        case .progressBar:
            if node.variant == "context-usage" {
                XgentContextUsage(node: node, document: document, model: model)
            } else { nativeProgressBar }
        case .badge:
            nativeBadge
        case .banner:
            nativeBanner
        case .emptyState:
            nativeEmptyState
        case .statusDot:
            nativeStatusDot
        case .collapsible:
            nativeCollapsible
        case .markdown:
            nativeMarkdown
        case .codeBlock:
            nativeCodeBlock
        case .list:
            if node.variant == "composer-suggestions" {
                XgentComposerSuggestions(node: node, document: document, model: model)
            } else { nativeList }
        case .providerList:
            XgentProviderListView(node: node, document: document, model: model)
        case .treeRow:
            nativeTreeRow
        case .navigationRow:
            if node.variant == "memory-entry" {
                XgentMemoryEntry(node: node, document: document, model: model)
            } else if node.variant == "sidebar-conversation-row" || node.variant == "sidebar-workspace-row" {
                XgentSidebarConversationRow(node: node, document: document, model: model)
            } else { navigationRow }
        case .chatLayout:
            chatLayout
        case .composer:
            composer
        case .composerInput:
            composerInput.modifier(XgentControlTypography(node: node))
        case .chatMessage:
            nativeChatMessage
        case .thinking:
            nativeThinking
        case .toolCall:
            nativeToolCall
        case .activityPreview:
            nativeActivityPreview
        case .taskProgress:
            XgentTaskProgressChip(node: node, document: document, model: model)
        case .taskStep:
            XgentTaskProgressStep(node: node)
        case .browserLayout:
            XgentBrowserLayout(node: node, document: document, model: model)
        case .browserViewport:
            nativeBrowserViewport
        case .mediaPreview:
            if node.variant == "workspace-image-preview" {
                XgentWorkspaceImagePreview(node: node, document: document, model: model)
            } else { nativeMediaPreview }
        case .spreadsheetGrid:
            XgentSpreadsheetGrid(node: node, document: document, model: model)
        case .htmlPreview:
            XgentHTMLPreview(source: node.text ?? "", encoded: node.value?.text ?? "", label: node.label ?? "HTML preview")
        case .filePicker:
            if node.variant == "skill-bundle" {
                XgentSkillBundlePicker(node: node, document: document, model: model)
            } else {
                XgentAttachmentPicker(node: node, document: document, model: model)
            }
        case .terminalLayout:
            XgentTerminalLayout(node: node, document: document, model: model)
        case .terminalToolbar:
            XgentTerminalToolbar(node: node, document: document, model: model)
        case .terminalViewport:
            XgentTerminalViewport(node: node, document: document, model: model)
        }
    }
}
