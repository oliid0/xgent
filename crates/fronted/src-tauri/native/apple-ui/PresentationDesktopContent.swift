import SwiftUI

// Handwritten desktop compositions. The shared document supplies business state
// and action identifiers; it does not select Astryx components or SwiftUI styles.
extension XgentNodeView {
    @ViewBuilder var desktopContent: some View {
        switch node.kind {
        case .vStack:
            VStack(alignment: .leading, spacing: node.spacing.map { CGFloat($0) }) { children }
        case .hStack:
            XgentHorizontalControls(node: node) { children }
        case .scrollView:
            ScrollView { LazyVStack(alignment: .leading, spacing: CGFloat(presentationTheme.spacing.md)) { children } }
        case .card:
            XgentDesktopSettingsCard(node: node, document: document, model: model)
        case .settingsGroup:
            XgentDesktopSettingsCard(node: node, document: document, model: model)
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
            XgentActionButton(node: node, document: document, model: model)
        case .iconButton:
            XgentIconButton(node: node, document: document, model: model)
        case .textInput:
            XgentTextInput(node: node, document: document, model: model)
        case .textArea:
            nativeTextArea
        case .numberInput:
            XgentNumberInput(node: node, document: document, model: model)
        case .timeInput:
            XgentTimeInput(node: node, document: document, model: model)
        case .colorInput:
            nativeColorInput.modifier(XgentControlTypography(node: node))
        case .toggle:
            XgentSwitch(node: node, document: document, model: model)
        case .selector:
            XgentSelector(node: node, document: document, model: model)
        case .segmentedControl:
            XgentSegmentedControl(node: node, document: document, model: model)
        case .menu:
            XgentNativeMenu(node: node, document: document, model: model)
        case .slider:
            XgentSlider(node: node, document: document, model: model)
        case .divider:
            Divider()
        case .spacer:
            Spacer(minLength: 0)
        case .progress:
            ProgressView(node.label ?? "").modifier(XgentControlTypography(node: node))
        case .progressBar:
            nativeProgressBar
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
            XgentMarkdown(text: node.text ?? "")
        case .codeBlock:
            XgentCodeBlock(text: node.text ?? "", language: node.language, label: node.label)
        case .list:
            nativeList
        case .treeRow:
            nativeTreeRow
        case .navigationRow:
            if node.variant == "sidebar-conversation-row" {
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
            nativeTaskProgress
        case .taskStep:
            nativeTaskStep
        case .browserLayout:
            nativeBrowserLayout
        case .browserViewport:
            nativeBrowserViewport
        case .mediaPreview:
            nativeMediaPreview
        case .htmlPreview:
            XgentHTMLPreview(source: node.text ?? "", encoded: node.value?.text ?? "", label: node.label ?? "HTML preview")
        case .filePicker:
            XgentAttachmentPicker(node: node, document: document, model: model)
        case .terminalLayout:
            XgentTerminalLayout(node: node, document: document, model: model)
        case .terminalToolbar:
            XgentTerminalToolbar(node: node, document: document, model: model)
        case .terminalViewport:
            XgentTerminalViewport(node: node, document: document, model: model)
        }
    }
}
