import SwiftUI
import SwiftTerm
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct XgentTerminalViewport: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        XgentPlatformTerminal(
            value: node.value?.text ?? "", fontSize: 14 * CGFloat(theme.fontScale),
            fontFamily: theme.codeFontFamily,
            colors: XgentTerminalColors(dark: colorScheme == .dark),
            label: node.label ?? "Terminal", emit: { value in
                model.send(node, in: document, value: .string(value), continuous: true)
            }
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(node.label ?? "Terminal")
    }
}

#if os(iOS)
struct XgentPlatformTerminal: UIViewRepresentable {
    let value: String
    let fontSize: CGFloat
    let fontFamily: String?
    let colors: XgentTerminalColors
    let label: String
    let emit: (String) -> Void

    func makeCoordinator() -> XgentTerminalCoordinator { XgentTerminalCoordinator(emit: emit) }

    func makeUIView(context: Context) -> TerminalView {
        let view = TerminalView(frame: .zero)
        view.lineSpacing = 1.1
        view.terminalDelegate = context.coordinator
        view.accessibilityLabel = label
        return view
    }

    func updateUIView(_ view: TerminalView, context: Context) {
        context.coordinator.emit = emit
        let font = XgentFonts.name(for: fontFamily).flatMap { UIFont(name: $0, size: fontSize) }
            ?? UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        if view.font != font { view.font = font }
        context.coordinator.updateColors(colors, view: view)
        context.coordinator.update(value: value, view: view)
    }

    static func dismantleUIView(_ view: TerminalView, coordinator: XgentTerminalCoordinator) {
        coordinator.retire()
        view.terminalDelegate = nil
        _ = view.resignFirstResponder()
    }
}
#else
struct XgentPlatformTerminal: NSViewRepresentable {
    let value: String
    let fontSize: CGFloat
    let fontFamily: String?
    let colors: XgentTerminalColors
    let label: String
    let emit: (String) -> Void

    func makeCoordinator() -> XgentTerminalCoordinator { XgentTerminalCoordinator(emit: emit) }

    func makeNSView(context: Context) -> TerminalView {
        let view = TerminalView(frame: .zero)
        view.lineSpacing = 1.1
        view.terminalDelegate = context.coordinator
        view.setAccessibilityLabel(label)
        return view
    }

    func updateNSView(_ view: TerminalView, context: Context) {
        context.coordinator.emit = emit
        let font = XgentFonts.name(for: fontFamily).flatMap { NSFont(name: $0, size: fontSize) }
            ?? NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        if view.font != font { view.font = font }
        context.coordinator.updateColors(colors, view: view)
        context.coordinator.update(value: value, view: view)
    }

    static func dismantleNSView(_ view: TerminalView, coordinator: XgentTerminalCoordinator) {
        coordinator.retire()
        view.terminalDelegate = nil
    }
}
#endif

extension XgentNodeView {
    var nativeTerminalViewport: some View { XgentTerminalViewport(node: node, document: document, model: model) }
}
