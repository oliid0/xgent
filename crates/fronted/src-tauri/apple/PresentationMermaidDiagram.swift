import Foundation
import SwiftDraw
import SwiftUI

struct XgentDiagramLabels: Decodable, Equatable {
    let copy: String
    let fullscreen: String
    let close: String
    let zoomIn: String
    let zoomOut: String
    let fit: String
    let loading: String
    let failed: String
    let retry: String
    static let fallback = Self(copy: "Copy diagram", fullscreen: "View fullscreen", close: "Close preview",
        zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit to window", loading: "Rendering diagram",
        failed: "Unable to render diagram", retry: "Retry")
}

struct XgentDiagramReply: Decodable {
    let source: String
    let dark: Bool
    let svg: String?
    let error: String?

    func image(source: String, dark: Bool) -> SVG? {
        guard self.source.utf16.elementsEqual(source.utf16), self.dark == dark,
              let svg, svg.utf8.count <= 4 * 1024 * 1024, let image = SVG(xml: svg),
              image.size.width.isFinite, image.size.height.isFinite,
              image.size.width > 0, image.size.height > 0,
              image.size.width <= 100_000, image.size.height <= 100_000 else { return nil }
        return image
    }
}

@MainActor
final class XgentDiagramState: ObservableObject {
    @Published private(set) var image: SVG?
    @Published private(set) var error: String?
    @Published private(set) var loading = false
    @Published var zoom: CGFloat = 1
    @Published var fullscreen = false
    private var request: String?
    private var generation = 0

    func load(source: String, dark: Bool, query: ((String, Bool) async -> String?)?) async {
        let key = "\(dark):\(source)"
        if let request, request.utf16.elementsEqual(key.utf16), image != nil { return }
        generation += 1
        let current = generation
        request = key; image = nil; error = nil; loading = true
        defer { if generation == current { loading = false } }
        guard !Task.isCancelled, source.utf8.count <= 200_000,
              let raw = await query?(source, dark), !Task.isCancelled, generation == current,
              let data = raw.data(using: .utf8), let reply = try? JSONDecoder().decode(XgentDiagramReply.self, from: data) else {
            if !Task.isCancelled && generation == current { error = "" }
            return
        }
        if let image = reply.image(source: source, dark: dark) { self.image = image }
        else { error = reply.error ?? "" }
    }
}

struct XgentMermaidDiagram: View {
    let source: String
    let configuration: XgentCodeBlockConfiguration
    var retainedState: XgentDiagramState? = nil
    var renderDiagram: ((String, Bool) async -> String?)? = nil
    @StateObject private var local = XgentDiagramState()

    var body: some View {
        XgentMermaidSurface(source: source, configuration: configuration, state: retainedState ?? local, renderDiagram: renderDiagram)
    }
}

private struct XgentMermaidSurface: View {
    let source: String
    let configuration: XgentCodeBlockConfiguration
    @ObservedObject var state: XgentDiagramState
    let renderDiagram: ((String, Bool) async -> String?)?
    @Environment(\.colorScheme) private var scheme
    @State private var copied = false
    @State private var retry = 0
    private var labels: XgentDiagramLabels { configuration.diagram }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    copied = XgentCodeClipboard.copy(source)
                } label: { Label(copied ? configuration.labels.copied : labels.copy, systemImage: copied ? "checkmark" : "doc.on.doc") }
                    .accessibilityIdentifier("xgent-diagram-copy")
                Spacer(minLength: 0)
                Button { state.fullscreen = true } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                    .accessibilityLabel(labels.fullscreen).disabled(state.image == nil)
                    .accessibilityIdentifier("xgent-diagram-fullscreen")
            }
            .buttonStyle(.plain).font(.caption)
            if let image = state.image {
                XgentDiagramViewport(image: image, labels: labels, zoom: $state.zoom).frame(height: 280)
            } else if state.loading {
                ProgressView(labels.loading).frame(maxWidth: .infinity, minHeight: 80)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(labels.failed).font(.caption).foregroundStyle(.secondary)
                    if let error = state.error, !error.isEmpty { Text(error).font(.caption).foregroundStyle(.secondary) }
                    Button(labels.retry) { retry += 1 }
                    XgentCodeBlock(text: source, language: "mermaid", configuration: configuration)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("xgent-mermaid-diagram")
        .task(id: "\(scheme == .dark):\(retry):\(source)") {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            await state.load(source: source, dark: scheme == .dark, query: renderDiagram)
        }
        .onChange(of: source) { _, _ in copied = false }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }; copied = false
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $state.fullscreen) { expanded }
        #else
        .sheet(isPresented: $state.fullscreen) { expanded.frame(minWidth: 640, minHeight: 480) }
        #endif
    }

    private var expanded: some View {
        VStack(spacing: 12) {
            HStack { Spacer(); Button(labels.close) { state.fullscreen = false }.keyboardShortcut(.cancelAction) }
            if let image = state.image { XgentDiagramViewport(image: image, labels: labels, zoom: $state.zoom) }
        }
        .padding().background { XgentThemeBackground() }
    }
}

struct XgentDiagramViewport: View {
    let image: SVG
    let labels: XgentDiagramLabels
    @Binding var zoom: CGFloat
    @GestureState private var magnification: CGFloat = 1
    private func clamp(_ value: CGFloat) -> CGFloat { min(8, max(1, value)) }

    var body: some View {
        GeometryReader { proxy in
            let scale = clamp(zoom * magnification)
            let width = max(1, proxy.size.width), height = max(1, proxy.size.height - 44)
            let fit = min(width / image.size.width, height / image.size.height)
            VStack(spacing: 0) {
                ScrollView([.horizontal, .vertical]) {
                    SVGView(svg: image).resizable().scaledToFit()
                        .frame(width: image.size.width * fit * scale, height: image.size.height * fit * scale)
                        .frame(minWidth: width, minHeight: height)
                        .accessibilityLabel("Mermaid")
                }
                .simultaneousGesture(MagnifyGesture().updating($magnification) { value, state, _ in state = value.magnification }
                    .onEnded { zoom = clamp(zoom * $0.magnification) })
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: zoom = clamp(zoom * 1.5)
                    case .decrement: zoom = clamp(zoom / 1.5)
                    @unknown default: break
                    }
                }
                HStack(spacing: 8) {
                    Button { zoom = clamp(zoom / 1.5) } label: { Image(systemName: "minus.magnifyingglass").frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel(labels.zoomOut).disabled(zoom <= 1)
                    Button("\(Int(zoom * 100))%") { zoom = 1 }.font(.caption.monospacedDigit())
                        .frame(minWidth: 64, minHeight: 44).accessibilityLabel(labels.fit)
                    Button { zoom = clamp(zoom * 1.5) } label: { Image(systemName: "plus.magnifyingglass").frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel(labels.zoomIn).disabled(zoom >= 8)
                }.buttonStyle(.plain)
            }
        }
    }
}
