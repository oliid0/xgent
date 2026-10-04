import Foundation

// Compatibility vocabulary for shared state and actions. This declares no UI
// components or rendering policy: each Apple screen is implemented in SwiftUI.
enum XgentNodeKind: String, Decodable, CaseIterable {
    case vStack = "VStack"
    case hStack = "HStack"
    case scrollView = "ScrollView"
    case card = "Card"
    case section = "Section"
    case text = "Text"
    case heading = "Heading"
    case button = "Button"
    case textInput = "TextInput"
    case shortcutRecorder = "ShortcutRecorder"
    case numberInput = "NumberInput"
    case colorInput = "ColorInput"
    case timeInput = "TimeInput"
    case textArea = "TextArea"
    case toggle = "Switch"
    case selector = "Selector"
    case segmentedControl = "SegmentedControl"
    case menu = "Menu"
    case divider = "Divider"
    case progress = "Progress"
    case progressBar = "ProgressBar"
    case badge = "Badge"
    case banner = "Banner"
    case emptyState = "EmptyState"
    case statusDot = "StatusDot"
    case slider = "Slider"
    case collapsible = "Collapsible"
    case markdown = "Markdown"
    case codeBlock = "CodeBlock"
    case list = "List"
    case providerList = "ProviderList"
    case treeRow = "TreeRow"
    case settingsGroup = "SettingsGroup"
    case settingsLayout = "SettingsLayout"
    case navigationRow = "NavigationRow"
    case iconButton = "IconButton"
    case spacer = "Spacer"
    case composer = "Composer"
    case composerInput = "ComposerInput"
    case chatLayout = "ChatLayout"
    case chatMessage = "ChatMessage"
    case thinking = "Thinking"
    case toolCall = "ToolCall"
    case activityPreview = "ActivityPreview"
    case taskProgress = "TaskProgress"
    case taskStep = "TaskStep"
    case browserViewport = "BrowserViewport"
    case browserLayout = "BrowserLayout"
    case mediaPreview = "MediaPreview"
    case spreadsheetGrid = "SpreadsheetGrid"
    case htmlPreview = "HTMLPreview"
    case filePicker = "FilePicker"
    case terminalLayout = "TerminalLayout"
    case terminalViewport = "TerminalViewport"
    case terminalToolbar = "TerminalToolbar"

    var eventSemantics: Set<String> {
        switch self {
        case .button, .menu, .navigationRow, .iconButton, .treeRow, .activityPreview:
            return ["press"]
        case .textInput:
            return ["changeText", "commitText"]
        case .textArea, .composerInput, .timeInput:
            return ["changeText"]
        case .numberInput, .slider:
            return ["changeNumber"]
        case .colorInput:
            return ["changeColor"]
        case .toggle:
            return ["changeBoolean"]
        case .selector, .segmentedControl:
            return ["changeSelection"]
        case .browserViewport:
            return ["reportViewport"]
        case .filePicker:
            return ["pickFiles"]
        case .terminalViewport:
            return ["streamTerminal"]
        case .providerList:
            return ["reorderProviders"]
        case .shortcutRecorder:
            return ["recordShortcut"]
        case .spreadsheetGrid:
            return ["changeCell"]
        case .markdown:
            return ["highlightCode", "renderDiagram"]
        case .codeBlock:
            return ["highlightCode"]
        default:
            return []
        }
    }
}
