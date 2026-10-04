import SwiftUI

private struct XgentTerminalChromeHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Terminal content owns scrolling; connection forms have a separate bounded scrollport.
struct XgentTerminalLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var chromeHeight: CGFloat = 0

    private var commandOutput: XgentNode? { node.children?.first { $0.id == "mobile-terminal-output" } }
    private var commandInput: XgentNode? { node.children?.first { $0.id == "mobile-terminal-input" } }

    private var viewport: XgentNode? { node.children?.first { $0.kind == .terminalViewport } }
    private var chrome: [XgentNode] { (node.children ?? []).filter { $0.kind != .terminalViewport } }

    @ViewBuilder var body: some View {
        if let commandOutput, let commandInput {
            XgentCommandTerminalLayout(output: commandOutput, input: commandInput,
                                       document: document, model: model)
        } else { ptyLayout }
    }

    private var ptyLayout: some View {
        GeometryReader { geometry in
            let viewportReserve = min(max(0, geometry.size.height - 44),
                min(300, max(120, geometry.size.height * 0.6)))
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) { nodes(chrome) }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(GeometryReader { content in
                            Color.clear.preference(key: XgentTerminalChromeHeight.self, value: content.size.height)
                        })
                }
                .frame(height: viewport == nil ? geometry.size.height :
                    min(chromeHeight, max(0, geometry.size.height - viewportReserve)))
                if let viewport {
                    // A PTY must fit the remaining viewport, including windows
                    // shorter than the document's preferred 300-point minimum.
                    XgentTerminalViewport(node: viewport, document: document, model: model)
                        .disabled(viewport.disabled == true)
                        .accessibilityIdentifier(viewport.id)
                        .modifier(XgentAccessibilityModifier(node: viewport))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .onPreferenceChange(XgentTerminalChromeHeight.self) { chromeHeight = $0 }
        .frame(idealWidth: 960, maxWidth: .infinity,
               idealHeight: 640, maxHeight: .infinity)
    }

    @ViewBuilder private func nodes(_ nodes: [XgentNode]) -> some View {
        #if os(iOS)
        XgentIOSNodes(nodes: nodes, document: document, model: model, parentAxis: .vertical)
        #else
        XgentNodeChildren(nodes: nodes, document: document, model: model)
        #endif
    }
}

/// Command execution has streamed text and stdin, rather than a PTY viewport.
/// Keep its input reachable while only the transcript follows incoming output.
private struct XgentCommandTerminalLayout: View {
    let output: XgentNode
    let input: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var followsOutput = true
    @State private var userScrolling = false

    private let endID = "command-terminal-end"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    nodes([output])
                    Color.clear.frame(height: 1).id(endID)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onScrollPhaseChange { _, phase, context in
                userScrolling = phase == .tracking || phase == .interacting || phase == .decelerating
                if phase != .animating {
                    followsOutput = context.geometry.contentSize.height - context.geometry.visibleRect.maxY < 40
                }
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentSize.height - geometry.visibleRect.maxY < 40
            } action: { _, atEnd in
                if userScrolling { followsOutput = atEnd }
            }
            .onChange(of: document.revision) {
                if followsOutput { proxy.scrollTo(endID, anchor: .bottom) }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ScrollView {
                    nodes([input]).padding(12)
                        .submitLabel(.send)
                        .onSubmit {
                            let targetID = input.children?.contains(where: { $0.id == "live-input" }) == true
                                ? "send-input" : "run"
                            if let action = document.node(id: targetID) { model.send(action, in: document) }
                        }
                }
                .frame(maxHeight: 220)
                .background { XgentThemeBackground() }
                .overlay(alignment: .top) { Divider() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private func nodes(_ nodes: [XgentNode]) -> some View {
        #if os(iOS)
        XgentIOSNodes(nodes: nodes, document: document, model: model, parentAxis: .vertical)
        #else
        XgentNodeChildren(nodes: nodes, document: document, model: model)
        #endif
    }
}

extension XgentNodeView {
    var nativeTerminalLayout: some View { XgentTerminalLayout(node: node, document: document, model: model) }
}
