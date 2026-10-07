import SwiftUI

struct XgentNumberInputEditor: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    let limits: XgentNumberInputConstraints
    @StateObject private var state = XgentNumberInputState()
    @State private var lease: UUID?
    @StateObject private var composition = XgentNumberComposition()
    @FocusState private var focused: Bool
    @Environment(\.isEnabled) private var enabled
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    private var value: Double? {
        if case .number(let value) = model.value(node, in: document) { return value }
        return nil
    }
    private var text: Binding<String> {
        Binding(get: { state.draft.display(value: value, focused: focused) }, set: { state.draft.pending = $0 })
    }
    private var invalid: Bool {
        guard let pending = state.draft.pending, !pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return state.draft.parsed(limits: limits, integerOnly: node.integerOnly == true) == nil
    }
    private func send(_ next: Double?) {
        guard enabled, node.disabled != true, next != value else { return }
        model.send(node, in: document, value: next.map(XgentValue.number) ?? .null, editing: true)
    }
    private func commit(blur: Bool) {
        guard enabled, node.disabled != true, !composition.marked else { return }
        switch state.draft.commit(blur: blur, limits: limits, integerOnly: node.integerOnly == true, clearable: node.clearable == true) {
        case .number(let value, _): send(value)
        case .clear: send(nil)
        case .revert: break
        }
    }
    private func step(_ direction: Int) -> KeyPress.Result {
        guard focused, enabled, node.disabled != true, !composition.marked else { return .ignored }
        let current: Double?
        if let pending = state.draft.pending, pending.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { current = nil }
        else { current = state.draft.parsed(limits: limits, integerOnly: node.integerOnly == true) ?? value }
        let next = XgentNumberInputStep.next(current, direction: direction, limits: limits, integerOnly: node.integerOnly == true)
        state.draft.pending = nil
        send(next)
        return .handled
    }

    @ViewBuilder private var field: some View {
        #if os(iOS)
        TextField(node.text ?? "", text: text).keyboardType(.numbersAndPunctuation)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        TextField(node.text ?? "", text: text)
        #endif
    }

    var body: some View {
        HStack(spacing: 4) {
            field.textFieldStyle(.plain)
                .focused($focused)
                .modifier(XgentNumberCompositionTarget(composition: composition))
                .onSubmit { commit(blur: false) }
                .onKeyPress(.upArrow) { step(1) }
                .onKeyPress(.downArrow) { step(-1) }
                .accessibilityIdentifier(node.id)
                .accessibilityLabel(node.accessibilityLabel ?? node.label ?? "")
            if node.clearable == true, value != nil, enabled, node.disabled != true {
                Button {
                    state.draft.pending = nil
                    send(nil)
                    focused = true
                } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                .buttonStyle(.plain)
                .focusable(false)
                .frame(minWidth: 32, minHeight: 44)
                .accessibilityLabel("Clear \(node.label ?? "")")
                .accessibilityIdentifier(node.id + ":clear")
            }
        }
        .modifier(XgentFieldSurface(node: node, active: focused, tracksFocus: false))
        .overlay {
            if invalid {
                RoundedRectangle(cornerRadius: CGFloat(theme.radius.element))
                    .stroke(Color(xgentHex: theme.palette(for: scheme).error ?? "#e3193b"), lineWidth: 1)
                    .allowsHitTesting(false)
            }
        }
        .onChange(of: focused) { previous, current in if previous && !current { commit(blur: true) } }
        .onChange(of: limits) { _, _ in state.draft.pending = nil }
        .onChange(of: node.integerOnly) { _, _ in state.draft.pending = nil }
        .onChange(of: node.clearable) { _, _ in state.draft.pending = nil }
        .onChange(of: node.disabled) { _, disabled in if disabled == true { state.draft.pending = nil } }
        .onAppear {
            state.composition = composition
            lease = model.numberDrafts.attach(surface: document.surface, node: node, state: state)
        }
        .onDisappear {
            state.draft.pending = nil
            model.numberDrafts.detach(surface: document.surface, node: node.id, lease: lease)
        }
    }
}
