import SwiftUI

struct XgentTerminalSessionTabs: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    private var options: [XgentOption] { node.options ?? [] }
    private var selected: String { model.value(node, in: document).text }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(options) { option in tab(option).id(option.value) }
                }
            }
            .scrollIndicators(.hidden)
            .focusable()
            .onKeyPress(.leftArrow) { select(-1) }
            .onKeyPress(.rightArrow) { select(1) }
            .onAppear { proxy.scrollTo(selected) }
            .onChange(of: selected) { _, id in proxy.scrollTo(id) }
        }
        .frame(minWidth: 120, maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(node.label ?? "")
    }

    private func tab(_ option: XgentOption) -> some View {
        let state = node.children?.first { $0.id == "terminal-session-state:\(option.value)" }
        let palette = theme.palette(for: scheme)
        return Button { model.send(node, in: document, value: .string(option.value)) } label: {
            VStack(spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: "terminal").accessibilityHidden(true)
                    Text(option.label).modifier(XgentControlTypography(node: node)).lineLimit(1)
                    if let state {
                        Circle().fill(Color(xgentHex: state.status == "running" ? palette.accent : palette.secondaryText))
                            .frame(width: 5, height: 5).accessibilityHidden(true)
                    }
                }.padding(.horizontal, 10).padding(.top, 6)
                Rectangle().fill(option.value == selected ? Color(xgentHex: palette.accent) : .clear).frame(height: 2)
            }
            .frame(minWidth: 80, maxWidth: 220, minHeight: document.formFactor == "mobile" ? 44 : 32)
            .background(option.value == selected ? Color(xgentHex: palette.muted) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(node.disabled == true || option.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier("\(node.id):\(option.value)")
        .accessibilityLabel(option.label)
        .accessibilityHint(state?.label ?? "")
        .accessibilityAddTraits(option.value == selected ? [.isSelected] : [])
        #if os(macOS)
        .help(state?.label ?? option.label)
        #endif
    }

    private func select(_ direction: Int) -> KeyPress.Result {
        let available = options.filter { $0.disabled != true }
        guard node.disabled != true, !model.isBusy(node, in: document), !available.isEmpty,
              let current = available.firstIndex(where: { $0.value == selected }) else { return .ignored }
        let next = available[(current + direction + available.count) % available.count]
        model.send(node, in: document, value: .string(next.value))
        return .handled
    }
}
