import Foundation
import SwiftUI
import WebKit

enum XgentValue: Codable, Equatable {
    case string(String), number(Double), bool(Bool), null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let boolean = try? value.decode(Bool.self) { self = .bool(boolean) }
        else if let number = try? value.decode(Double.self), number.isFinite { self = .number(number) }
        else { self = .string(try value.decode(String.self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let text): try value.encode(text)
        case .number(let number): try value.encode(number)
        case .bool(let boolean): try value.encode(boolean)
        case .null: try value.encodeNil()
        }
    }

    var text: String {
        switch self {
        case .string(let text): return text
        case .number(let number): return String(number)
        default: return ""
        }
    }
    var boolean: Bool { self == .bool(true) }
}

struct XgentOption: Decodable, Identifiable {
    let value: String
    let label: String
    let disabled: Bool?
    let group: String?
    let groupLabel: String?
    var id: String { value }

    var displayLabel: String {
        guard let groupLabel else { return label }
        let prefix = groupLabel + " · "
        return label.hasPrefix(prefix) ? String(label.dropFirst(prefix.count)) : label
    }
}

struct XgentPalette: Decodable {
    let accent: String
    let accentText: String
    let background: String
    let surface: String
    let card: String
    let popover: String
    let muted: String
    let text: String
    let secondaryText: String
    let disabledText: String
    let border: String
    let emphasizedBorder: String
    let shadow: String
    var onAccent: String? = nil
    var neutral: String? = nil
    var error: String? = nil
    var onError: String? = nil

    func validate() throws {
        let colors = [accent, accentText, background, surface, card, popover, muted, text,
                      secondaryText, disabledText, border, emphasizedBorder, shadow]
            + [onAccent, neutral, error, onError].compactMap { $0 }
        guard colors.allSatisfy({ $0.range(of: #"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"#,
                                              options: .regularExpression) != nil }) else {
            throw XgentProtocolError.invalid
        }
    }
}

struct XgentRadii: Decodable {
    let inner: Double
    let element: Double
    let container: Double
    let overlay: Double
    let chat: Double
}

struct XgentSpacing: Decodable { let xs: Double, sm: Double, md: Double, lg: Double, xl: Double }
struct XgentControlMetrics: Decodable { let small: Double, medium: Double, large: Double }
struct XgentTypography: Decodable { let caption: Double, supporting: Double, body: Double }
struct XgentMotion: Decodable { let fast: Double, medium: Double, slow: Double, curve: [Double] }
struct XgentMaterialMode: Decodable {
    let surfaceOpacity: Double
    let popoverOpacity: Double
    let shadowOpacity: Double
}
struct XgentMaterial: Decodable {
    let light: XgentMaterialMode
    let dark: XgentMaterialMode
    let blur: Double
    let saturation: Double
}

struct XgentPresentationTheme: Decodable {
    let light: XgentPalette
    let dark: XgentPalette
    let radius: XgentRadii
    let spacing: XgentSpacing
    let control: XgentControlMetrics
    let typography: XgentTypography
    let motion: XgentMotion
    let material: XgentMaterial
    let fontScale: Double
    let fontFamily: String?
    let codeFontFamily: String?

    func validate() throws {
        guard (fontFamily?.utf8.count ?? 0) <= 800,
              (codeFontFamily?.utf8.count ?? 0) <= 800 else { throw XgentProtocolError.invalid }
        try light.validate()
        try dark.validate()
        let dimensions = [radius.inner, radius.element, radius.container, radius.overlay, radius.chat,
                          spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl,
                          control.small, control.medium, control.large,
                          typography.caption, typography.supporting, typography.body,
                          motion.fast, motion.medium, motion.slow, material.blur,
                          material.saturation, fontScale] + motion.curve
        guard dimensions.allSatisfy(\.isFinite),
              dimensions.allSatisfy({ $0 >= 0 }),
              (0...64).contains(radius.element),
              (0...64).contains(radius.container),
              (0...96).contains(radius.overlay),
              (0...96).contains(radius.chat),
              (0...96).contains(radius.inner),
              motion.curve.count == 4,
              [material.light.surfaceOpacity, material.light.popoverOpacity,
               material.light.shadowOpacity, material.dark.surfaceOpacity,
               material.dark.popoverOpacity, material.dark.shadowOpacity]
                .allSatisfy({ (0...1).contains($0) }),
              (0.5...3).contains(material.saturation),
              (0.8...1.4).contains(fontScale) else {
            throw XgentProtocolError.invalid
        }
    }
}

struct XgentNode: Decodable, Identifiable {
    let id: String
    let kind: XgentNodeKind
    let label: String?
    let text: String?
    let value: XgentValue?
    let action: String?
    let focusRequest: Int?
    let disabled: Bool?
    let destructive: Bool?
    let prominent: Bool?
    let secure: Bool?
    let secondary: Bool?
    let spacing: Double?
    let padding: Double?
    let indent: Double?
    let fill: Bool?
    let alignment: String?
    let width: Double?
    let minWidth: Double?
    let maxWidth: Double?
    let height: Double?
    let minHeight: Double?
    let maxHeight: Double?
    let maxLines: Int?
    let wrap: Bool?
    let variant: String?
    let size: String?
    let icon: String?
    let selected: Bool?
    let role: String?
    let status: String?
    let language: String?
    let minimum: Double?
    let maximum: Double?
    let step: Double?
    let integerOnly: Bool?
    let clearable: Bool?
    let current: Double?
    let total: Double?
    let options: [XgentOption]?
    let accessibilityLabel: String?
    let accessibilityHint: String?
    let accessibilityValue: String?
    let children: [XgentNode]?
}

struct XgentDocument: Decodable, Identifiable {
    enum Mode: String, Decodable { case root, sheet, alert, sidebar, panel, toast, status }
    enum Appearance: String, Decodable { case system, light, dark }
    enum FormFactor: String, Decodable { case mobile, desktop }
    let version: Int
    let surface: String
    let revision: Int
    let mode: Mode
    let title: String
    let appearance: Appearance
    let formFactor: FormFactor?
    let workspacePanel: XgentWorkspacePanelControls?
    let theme: XgentPresentationTheme?
    let nodes: [XgentNode]
    let dismissAction: String?
    let readingAction: String?
    let removed: Bool?
    var id: String { surface }

    func node(id: String) -> XgentNode? {
        func find(_ nodes: [XgentNode]) -> XgentNode? {
            for node in nodes {
                if node.id == id { return node }
                if let child = find(node.children ?? []) { return child }
            }
            return nil
        }
        return find(nodes)
    }

    var colorScheme: ColorScheme? {
        switch appearance {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    func validate() throws {
        guard version == 1, !surface.isEmpty, revision > 0 else { throw XgentProtocolError.invalid }
        if mode == .toast, removed != true {
            guard dismissAction?.isEmpty == false, readingAction?.isEmpty == false,
                  nodes.count == 1, let message = nodes.first, message.kind == .banner,
                  message.variant == "toast", message.text != nil,
                  message.children?.count == 1, let close = message.children?.first,
                  close.kind == .button, close.action == dismissAction else { throw XgentProtocolError.invalid }
        }
        if readingAction != nil, mode != .toast { throw XgentProtocolError.invalid }
        if mode == .status, removed != true {
            guard nodes.count == 1, let message = nodes.first, message.kind == .banner,
                  message.variant == "service-status", message.label != nil, message.text != nil,
                  let actions = message.children, !actions.isEmpty,
                  actions.allSatisfy({ $0.kind == .button && $0.action != nil }) else { throw XgentProtocolError.invalid }
        }
        if mode == .panel, removed != true {
            guard formFactor == .desktop, dismissAction?.isEmpty == false,
                  let workspacePanel, workspacePanel.isValid else { throw XgentProtocolError.invalid }
        }
        try theme?.validate()
        var ids = Set<String>()
        func visit(_ nodes: [XgentNode], depth: Int) throws {
            guard depth < 64, ids.count <= 20000 else { throw XgentProtocolError.invalid }
            for node in nodes {
                guard ids.count < 20000, !node.id.isEmpty, ids.insert(node.id).inserted else {
                    throw XgentProtocolError.invalid
                }
                for dimension in [node.spacing, node.padding, node.indent, node.width, node.minWidth,
                                  node.maxWidth, node.height, node.minHeight, node.maxHeight].compactMap({ $0 }) {
                    guard dimension.isFinite, dimension >= 0, dimension <= 10000 else { throw XgentProtocolError.invalid }
                }
                guard node.role.map({ ["user", "assistant", "system"].contains($0) }) ?? true,
                      node.status.map({ ["pending", "running", "completed", "error", "paused"].contains($0) }) ?? true,
                      node.alignment.map({ ["leading", "center", "trailing"].contains($0) }) ?? true,
                      node.size.map({ ["small", "medium", "large"].contains($0) }) ?? true,
                      node.maxLines.map({ (1...10000).contains($0) }) ?? true,
                      node.focusRequest.map({ node.kind == .composerInput && (0...9_007_199_254_740_991).contains($0) }) ?? true,
                      node.action == nil || !node.kind.eventSemantics.isEmpty else {
                    throw XgentProtocolError.invalid
                }
                let measures = [node.minimum, node.maximum, node.step, node.current, node.total].compactMap { $0 }
                // Business ranges are finite, not screen dimensions. In particular,
                // PDF/Office annotation pages use the shared Int32 maximum.
                guard measures.allSatisfy({ $0.isFinite }) else { throw XgentProtocolError.invalid }
                if let minimum = node.minimum, let maximum = node.maximum {
                    guard minimum <= maximum else { throw XgentProtocolError.invalid }
                }
                if let step = node.step { guard step > 0 else { throw XgentProtocolError.invalid } }
                if node.integerOnly != nil || node.clearable != nil {
                    guard node.kind == .numberInput else { throw XgentProtocolError.invalid }
                }
                if node.kind == .numberInput {
                    guard let limits = XgentNumberInputConstraints(minimum: node.minimum, maximum: node.maximum, step: node.step,
                                                                  allowsUnboundedMaximum: node.clearable == true),
                          let storedValue = node.value else { throw XgentProtocolError.invalid }
                    switch storedValue {
                    case .null where node.clearable == true: break
                    case .number(let value) where limits.range.contains(value) && (node.integerOnly != true || value.rounded() == value): break
                    default: throw XgentProtocolError.invalid
                    }
                }
                if let total = node.total { guard total >= 0 else { throw XgentProtocolError.invalid } }
                if let options = node.options {
                    guard Set(options.map(\.value)).count == options.count else { throw XgentProtocolError.invalid }
                }
                try visit(node.children ?? [], depth: depth + 1)
            }
        }
        try visit(nodes, depth: 0)
        if mode == .alert, removed != true {
            let buttons = nodes.filter { $0.kind == .button }
            guard buttons.count == 2, buttons.allSatisfy({ $0.action != nil && $0.disabled != true }),
                  nodes.allSatisfy({ $0.kind == .button || $0.kind == .text }) else {
                throw XgentProtocolError.invalid
            }
        }
    }
}

enum XgentProtocolError: Error { case invalid }

struct XgentAction: Encodable {
    let surface: String
    let action: String
    let requestId: String
    let value: XgentValue
}

struct XgentActionResult: Decodable {
    let surface: String
    let requestId: String
    let ok: Bool
    let error: String?
    var acceptedValue: XgentValue? = nil
}

@MainActor
final class XgentPresentationModel: ObservableObject {
    let codeSessions = XgentCodeSessionStore()
    let codeHosts = XgentCodeHostStore()
    @Published private(set) var documents: [XgentDocument] = []
    @Published private(set) var edits: [String: XgentValue] = [:]
    @Published private(set) var busy: Set<String> = []
    @Published var error: String?
    weak var webview: WKWebView?
    var actionSink: (@MainActor (XgentAction) -> Void)?
    private var revisions: [String: Int] = [:]
    private var pending: [String: (surface: String, node: String, revision: Int)] = [:]
    private var editRequests: [String: String] = [:]
    private var acknowledgedEdits: Set<String> = []
    private var consumedFocusRequests: [String: Int] = [:]
    private var active = true
    private var codeHighlightQueries: [String: XgentCodeHighlightQuery] = [:]
    let numberDrafts = XgentNumberDraftStore()
    private var numberCommitBatches: [String: XgentNumberCommitBatch] = [:]
    @Published private var numberCommitCount = 0
    private var announcedNotifications = Set<String>()

    func invalidate() {
        for batch in Array(numberCommitBatches.values) { batch.finish(false) }
        numberDrafts.clear()
        for query in codeHighlightQueries.values { query.finish(nil) }
        codeHighlightQueries.removeAll()
        codeHosts.clear()
        codeSessions.clear()
        active = false
        webview = nil
        actionSink = nil
        pending.removeAll()
        editRequests.removeAll()
        acknowledgedEdits.removeAll()
        consumedFocusRequests.removeAll()
        revisions.removeAll()
        busy.removeAll()
        edits.removeAll()
        error = nil
        documents.removeAll()
        announcedNotifications.removeAll()
    }

    func update(_ document: XgentDocument) {
        guard active else { return }
        guard document.revision > (revisions[document.surface] ?? 0) else { return }
        revisions[document.surface] = document.revision
        if document.removed == true {
            for batch in Array(numberCommitBatches.values) where batch.surface == document.surface { batch.finish(false) }
            numberDrafts.clear(surface: document.surface)
            for (id, query) in codeHighlightQueries where query.surface == document.surface {
                codeHighlightQueries.removeValue(forKey: id)?.finish(nil)
            }
            for scope in codeHosts.remove(surface: document.surface) { codeSessions.reconcile(scope: scope, open: []) }
            announcedNotifications.remove(document.surface)
            documents.removeAll { $0.surface == document.surface }
            for (request, item) in pending where item.surface == document.surface {
                pending.removeValue(forKey: request)
            }
            let prefix = key(document.surface, "")
            busy = busy.filter { !$0.hasPrefix(prefix) }
            edits = edits.filter { !$0.key.hasPrefix(prefix) }
            editRequests = editRequests.filter { !$0.key.hasPrefix(prefix) }
            acknowledgedEdits = acknowledgedEdits.filter { !$0.hasPrefix(prefix) }
            consumedFocusRequests = consumedFocusRequests.filter { !$0.key.hasPrefix(prefix) }
            return
        }
        for node in document.nodes {
            let previousScopes = codeHosts.scopes(on: document.surface)
            if let sessions = XgentCodeHostSessions.decode(node), codeHosts.reconcile(sessions, surface: document.surface) {
                for scope in previousScopes where scope != sessions.scope { codeSessions.reconcile(scope: scope, open: []) }
                codeSessions.reconcile(scope: sessions.scope, open: sessions.open)
            }
        }
        if let index = documents.firstIndex(where: { $0.surface == document.surface }) {
            documents[index] = document
        } else { documents.append(document) }
        reconcileEdits(document)
        for batch in Array(numberCommitBatches.values) where batch.surface == document.surface {
            let current = document.node(id: batch.node)
            if current?.action != batch.action.action || current?.kind != batch.kind || current?.disabled == true { batch.finish(false) }
        }
        for (id, query) in codeHighlightQueries where query.surface == document.surface {
            let current = document.node(id: query.node)
            if current?.action != query.action || current?.kind.rawValue != query.kind || current?.disabled == true {
                codeHighlightQueries.removeValue(forKey: id)?.finish(nil)
            }
        }
    }

    private func reconcileEdits(_ document: XgentDocument) {
        var visibleNodes = Set<String>()
        func visit(_ nodes: [XgentNode]) {
            for node in nodes {
                let nodeKey = key(document.surface, node.id)
                visibleNodes.insert(nodeKey)
                if acknowledgedEdits.contains(nodeKey), edits[nodeKey] == node.value {
                    edits.removeValue(forKey: nodeKey)
                    editRequests.removeValue(forKey: nodeKey)
                    acknowledgedEdits.remove(nodeKey)
                }
                visit(node.children ?? [])
            }
        }
        visit(document.nodes)
        // Settings pages share a surface. A normalized edit (URL suffix, trimmed
        // name) may never equal its persisted value; do not carry that draft into
        // another page that reuses the same field ID.
        let prefix = key(document.surface, "")
        for nodeKey in Array(edits.keys) where nodeKey.hasPrefix(prefix) && !visibleNodes.contains(nodeKey) {
            edits.removeValue(forKey: nodeKey)
            editRequests.removeValue(forKey: nodeKey)
            acknowledgedEdits.remove(nodeKey)
        }
    }

    private func key(_ surface: String, _ node: String) -> String { "\(surface.count):\(surface)\(node)" }

    func isBusy(_ node: XgentNode, in document: XgentDocument) -> Bool {
        busy.contains(key(document.surface, node.id))
    }

    func value(_ node: XgentNode, in document: XgentDocument) -> XgentValue {
        let current = documents.first { $0.surface == document.surface }?.node(id: node.id)
        return edits[key(document.surface, node.id)] ?? current?.value ?? node.value ?? .null
    }

    func consumeFocusRequest(_ node: XgentNode, in document: XgentDocument) -> Bool {
        guard active,
              let current = documents.first(where: { $0.surface == document.surface })?.node(id: node.id),
              current.kind == .composerInput, current.disabled != true,
              let request = current.focusRequest, request > 0 else { return false }
        let nodeKey = key(document.surface, node.id)
        guard request > (consumedFocusRequests[nodeKey] ?? 0) else { return false }
        consumedFocusRequests[nodeKey] = request
        return true
    }

    func send(_ node: XgentNode, in document: XgentDocument, value: XgentValue = .null,
              editing: Bool = false, continuous: Bool = false) {
        guard active else { return }
        guard !continuous || ((node.kind == .terminalViewport || node.kind == .shortcutRecorder || node.kind == .spreadsheetGrid) && !editing) else { return }
        guard node.disabled != true,
              let current = documents.first(where: { $0.surface == document.surface })?.node(id: node.id),
              current.kind == node.kind, current.action == node.action,
              current.disabled != true, let action = current.action else { return }
        let nodeKey = key(document.surface, node.id)
        if !editing && !continuous && busy.contains(nodeKey) { return }
        let requestId = UUID().uuidString
        if editing {
            edits[nodeKey] = value
            editRequests[nodeKey] = requestId
            acknowledgedEdits.remove(nodeKey)
        } else if !continuous { busy.insert(nodeKey) }
        pending[requestId] = (document.surface, nodeKey, document.revision)
        let event = XgentAction(surface: document.surface, action: action, requestId: requestId, value: value)
        if !editing && !continuous, deferForNumberCommits(event, node: current) { return }
        emit(event)
    }

    func hasNumberCommitBatch(in document: XgentDocument) -> Bool {
        numberCommitBatches.values.contains { $0.surface == document.surface }
    }

    private func deferForNumberCommits(_ event: XgentAction, node: XgentNode) -> Bool {
        guard let document = documents.first(where: { $0.surface == event.surface }) else { return false }
        var numbers: [XgentNode] = []
        func visit(_ nodes: [XgentNode]) {
            for node in nodes {
                if node.kind == .numberInput { numbers.append(node) }
                visit(node.children ?? [])
            }
        }
        visit(document.nodes)
        var waits: [String] = [], updates: [XgentAction] = []
        for number in numbers {
            let numberKey = key(document.surface, number.id)
            if let next = numberDrafts.commit(number, surface: document.surface), next != value(number, in: document), let action = number.action {
                let id = UUID().uuidString
                edits[numberKey] = next; editRequests[numberKey] = id; acknowledgedEdits.remove(numberKey)
                pending[id] = (document.surface, numberKey, document.revision)
                waits.append(id)
                updates.append(.init(surface: document.surface, action: action, requestId: id, value: next))
            } else if let id = editRequests[numberKey], pending[id] != nil { waits.append(id) }
        }
        guard !waits.isEmpty else { return false }
        let batch = XgentNumberCommitBatch(surface: document.surface, node: node.id, kind: node.kind, action: event, requests: waits) { [weak self] success in
            guard let self else { return }
            self.numberCommitBatches.removeValue(forKey: event.requestId)
            self.numberCommitCount = self.numberCommitBatches.count
            let current = self.documents.first { $0.surface == event.surface }?.node(id: node.id)
            if success, self.active, current?.kind == node.kind, current?.action == event.action, current?.disabled != true {
                self.emit(event)
            } else {
                self.pending.removeValue(forKey: event.requestId)
                self.busy.remove(self.key(event.surface, node.id))
            }
        }
        numberCommitBatches[event.requestId] = batch
        numberCommitCount = numberCommitBatches.count
        batch.timeout = Task { [weak self, weak batch] in
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { return }
            batch?.finish(false)
            self?.error = "The numeric field could not finish committing."
        }
        // All waits exist before any emission, including synchronous test sinks.
        for update in updates { emit(update) }
        return true
    }

    func isDismissing(_ document: XgentDocument) -> Bool { busy.contains(key(document.surface, "$dismiss")) }

    func highlightCode(_ node: XgentNode, in document: XgentDocument, source: String, language: String) async -> String? {
        let id = UUID().uuidString
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard active, !Task.isCancelled, node.kind == .markdown || node.kind == .codeBlock,
                      let current = documents.first(where: { $0.surface == document.surface })?.node(id: node.id),
                      current.kind == node.kind, current.action == node.action, current.disabled != true,
                      let action = current.action,
                      let data = try? JSONSerialization.data(withJSONObject: ["source": source, "language": language]),
                      let value = String(data: data, encoding: .utf8) else {
                    continuation.resume(returning: nil); return
                }
                let query = XgentCodeHighlightQuery(surface: document.surface, node: node.id, action: action, kind: node.kind.rawValue, continuation: continuation)
                codeHighlightQueries[id] = query
                query.timeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(10))
                    guard !Task.isCancelled else { return }
                    self?.codeHighlightQueries.removeValue(forKey: id)?.finish(nil)
                }
                emit(XgentAction(surface: document.surface, action: action, requestId: id, value: .string(value)))
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.codeHighlightQueries.removeValue(forKey: id)?.finish(nil) }
        }
    }

    func consumeNotificationAnnouncement(_ document: XgentDocument) -> Bool {
        guard active, document.mode == .toast,
              documents.contains(where: { $0.surface == document.surface && $0.mode == .toast }) else { return false }
        return announcedNotifications.insert(document.surface).inserted
    }

    func setNotificationReading(_ reading: Bool, in document: XgentDocument) {
        guard active, document.mode == .toast,
              let current = documents.first(where: { $0.surface == document.surface }),
              current.mode == .toast, let action = current.readingAction,
              action == document.readingAction else { return }
        let requestId = UUID().uuidString
        pending[requestId] = (document.surface, key(document.surface, "$reading"), current.revision)
        emit(XgentAction(surface: document.surface, action: action, requestId: requestId, value: .bool(reading)))
    }

    func dismiss(_ document: XgentDocument) {
        guard active else { return }
        guard let current = documents.first(where: { $0.surface == document.surface }),
              let action = current.dismissAction, action == document.dismissAction else { return }
        let nodeKey = key(document.surface, "$dismiss")
        guard !busy.contains(nodeKey) else { return }
        codeHosts.commit(in: current)
        let requestId = UUID().uuidString
        busy.insert(nodeKey)
        pending[requestId] = (document.surface, nodeKey, current.revision)
        let sourceAction = current.node(id: action)
        let sourceDraft = sourceAction?.variant == "workspace-source-action"
            ? sourceAction.flatMap { XgentWorkspaceSourceDraft.current(for: $0, in: current, model: self)?.encoded } : nil
        emit(XgentAction(surface: document.surface, action: action, requestId: requestId,
                         value: sourceDraft.map(XgentValue.string) ?? .null))
    }

    private func emit(_ action: XgentAction) {
        if let actionSink {
            actionSink(action)
            return
        }
        guard let webview else {
            complete(XgentActionResult(surface: action.surface, requestId: action.requestId,
                                       ok: false, error: "The application connection is unavailable."))
            return
        }
        do {
            let json = try JSONEncoder().encode(action)
            let value = try JSONSerialization.jsonObject(with: json)
            webview.callAsyncJavaScript(
                "return !window.dispatchEvent(new CustomEvent('xgent:native-action', {detail: action, cancelable: true}));",
                arguments: ["action": value], in: nil, in: .page
            ) { [weak self] result in
                let received: Bool
                switch result {
                case .success(let value):
                    received = (value as? NSNumber)?.boolValue == true
                case .failure:
                    received = false
                }
                if !received {
                    self?.complete(XgentActionResult(surface: action.surface, requestId: action.requestId,
                                                    ok: false, error: "The application could not receive this action."))
                }
            }
        } catch {
            complete(XgentActionResult(surface: action.surface, requestId: action.requestId,
                                       ok: false, error: "The action could not be encoded."))
        }
    }

    func complete(_ result: XgentActionResult) {
        defer {
            for batch in Array(numberCommitBatches.values) { batch.settle(result) }
        }
        if let query = codeHighlightQueries[result.requestId] {
            guard query.surface == result.surface else { return }
            codeHighlightQueries.removeValue(forKey: result.requestId)
            query.finish(result.ok ? result.acceptedValue?.text : nil)
            return
        }
        guard let request = pending[result.requestId], request.surface == result.surface else { return }
        pending.removeValue(forKey: result.requestId)
        busy.remove(request.node)
        if editRequests[request.node] == result.requestId {
            if result.ok {
                if let value = result.acceptedValue { edits[request.node] = value }
                // An action acknowledgement can precede React's next document. Keep the
                // local edit until the shared value arrives to avoid jumping the caret.
                acknowledgedEdits.insert(request.node)
                if let document = documents.first(where: { $0.surface == result.surface }) {
                    reconcileEdits(document)
                }
            } else {
                edits.removeValue(forKey: request.node)
                editRequests.removeValue(forKey: request.node)
                acknowledgedEdits.remove(request.node)
            }
        }
        if !result.ok { error = result.error ?? "The action failed." }
    }
}
