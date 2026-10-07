import PDFKit
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct XgentPDFHighlight: Codable, Equatable {
    let id: String
    let pageIndex: Int
    let rects: [[Double]]
    let color: String
}

private struct XgentPDFEditingMetadata: Decodable {
    let highlights: [XgentPDFHighlight]
    let labels: [String: String]
}

// Keep the input identity separate from PDFKit's serialized representation.
// Re-serializing a document is not an unchanged-file check and can reset its
// current page, zoom and selection on unrelated presentation updates.
@MainActor
struct XgentPDFPreview {
    let data: Data
    var highlights: [XgentPDFHighlight] = []
    var session: Coordinator? = nil
    @MainActor final class Coordinator: ObservableObject {
        private var loadedData: Data?
        private var displayedHighlights: [XgentPDFHighlight] = []
        private var draftAnnotations: [(PDFPage, PDFAnnotation)] = []
        weak var view: PDFView?
        @Published var hasSelection = false
        @Published var invalidDocument = false
        func load(_ data: Data, into view: PDFView) {
            guard loadedData != data else { return }
            loadedData = data
            self.view = view
            displayedHighlights = []
            draftAnnotations = []
            view.document = PDFDocument(data: data)
            view.autoScales = true
            let invalid = view.document == nil
            Task { @MainActor [weak self] in
                await Task.yield()
                guard let self, self.loadedData == data else { return }
                self.invalidDocument = invalid
                self.hasSelection = false
            }
        }
        func show(_ highlights: [XgentPDFHighlight], in view: PDFView) {
            guard displayedHighlights != highlights else { return }
            for (page, annotation) in draftAnnotations { page.removeAnnotation(annotation) }
            draftAnnotations = []
            displayedHighlights = highlights
            for entry in highlights {
                guard let page = view.document?.page(at: entry.pageIndex) else { continue }
                let channels = Self.channels(entry.color)
                for rect in entry.rects where rect.count == 4 && rect.allSatisfy(\.isFinite) && rect[2] > 0 && rect[3] > 0 {
                    let bounds = CGRect(x: rect[0], y: rect[1], width: rect[2], height: rect[3])
                    let annotation = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
                    #if os(iOS)
                    annotation.color = UIColor(red: channels.0, green: channels.1, blue: channels.2, alpha: 0.4)
                    annotation.quadrilateralPoints = [CGPoint(x: 0, y: bounds.height), CGPoint(x: bounds.width, y: bounds.height), .zero, CGPoint(x: bounds.width, y: 0)].map { NSValue(cgPoint: $0) }
                    #else
                    annotation.color = NSColor(red: channels.0, green: channels.1, blue: channels.2, alpha: 0.4)
                    annotation.quadrilateralPoints = [NSPoint(x: 0, y: bounds.height), NSPoint(x: bounds.width, y: bounds.height), .zero, NSPoint(x: bounds.width, y: 0)].map { NSValue(point: $0) }
                    #endif
                    annotation.shouldPrint = true
                    page.addAnnotation(annotation)
                    draftAnnotations.append((page, annotation))
                }
            }
        }
        func selectedHighlights(color: String) -> [XgentPDFHighlight] {
            guard let selection = view?.currentSelection, let document = view?.document,
                  !(selection.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
            var rectangles: [Int: [[Double]]] = [:]
            for line in selection.selectionsByLine() {
                for page in line.pages {
                    let index = document.index(for: page)
                    let rect = line.bounds(for: page).intersection(page.bounds(for: .mediaBox))
                    guard index >= 0, index < document.pageCount, !rect.isNull,
                          rect.width > 0, rect.height > 0,
                          [rect.minX, rect.minY, rect.width, rect.height].allSatisfy(\.isFinite) else { continue }
                    if (rectangles[index]?.count ?? 0) < 256 {
                        rectangles[index, default: []].append([Double(rect.minX), Double(rect.minY), Double(rect.width), Double(rect.height)])
                    }
                }
            }
            return rectangles.keys.sorted().prefix(512).map {
                XgentPDFHighlight(id: UUID().uuidString, pageIndex: $0, rects: rectangles[$0] ?? [], color: color)
            }
        }
        private static func channels(_ color: String) -> (CGFloat, CGFloat, CGFloat) {
            switch color {
            case "green": return (0.35, 0.85, 0.45)
            case "pink": return (1, 0.45, 0.7)
            default: return (1, 0.85, 0.15)
            }
        }
    }
    func makeCoordinator() -> Coordinator { session ?? Coordinator() }
    private func makeView(_ coordinator: Coordinator) -> PDFView {
        let view = PDFView()
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        coordinator.load(data, into: view)
        coordinator.show(highlights, in: view)
        return view
    }
}

#if os(iOS)
extension XgentPDFPreview: UIViewRepresentable {
    func makeUIView(context: Context) -> PDFView { makeView(context.coordinator) }
    func updateUIView(_ view: PDFView, context: Context) {
        context.coordinator.load(data, into: view)
        context.coordinator.show(highlights, in: view)
    }
}
#else
extension XgentPDFPreview: NSViewRepresentable {
    func makeNSView(context: Context) -> PDFView { makeView(context.coordinator) }
    func updateNSView(_ view: PDFView, context: Context) {
        context.coordinator.load(data, into: view)
        context.coordinator.show(highlights, in: view)
    }
}
#endif

@MainActor
struct XgentPDFEditor: View {
    let data: Data
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @StateObject private var coordinator = XgentPDFPreview.Coordinator()
    @State private var color = "yellow"
    private var metadata: XgentPDFEditingMetadata? {
        guard let data = node.text?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(XgentPDFEditingMetadata.self, from: data)
    }
    private func label(_ key: String) -> String { metadata?.labels[key] ?? key }
    private var action: XgentNode? { node.children?.first(where: { $0.id == "workspace-file-pdf-highlight" }) }
    private var disabled: Bool { node.disabled == true || action == nil || (action.map { model.isBusy($0, in: document) } ?? true) }
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Picker(label("color"), selection: $color) {
                        ForEach(["yellow", "green", "pink"], id: \.self) { Text(label($0)).tag($0) }
                    }.pickerStyle(.menu).accessibilityIdentifier("workspace-file-pdf-color")
                    Spacer(minLength: 8)
                    Button(label("undo"), systemImage: "arrow.uturn.backward") {
                        if let action { model.send(action, in: document, value: .string("undo")) }
                    }.disabled(disabled || (metadata?.highlights.isEmpty ?? true))
                        .accessibilityIdentifier("workspace-file-pdf-undo")
                }
                Button(label("highlight"), systemImage: "highlighter") {
                    let highlights = coordinator.selectedHighlights(color: color)
                    guard !highlights.isEmpty, let data = try? JSONEncoder().encode(highlights),
                          let payload = String(data: data, encoding: .utf8) else { return }
                    if let action { model.send(action, in: document, value: .string(payload)) }
                    coordinator.view?.clearSelection()
                }.disabled(disabled || !coordinator.hasSelection || (metadata?.highlights.count ?? 0) >= 512)
                    .accessibilityIdentifier("workspace-file-pdf-highlight")
            }.padding(8)
            if coordinator.invalidDocument {
                ContentUnavailableView(label("invalid"), systemImage: "doc.questionmark")
            }
            XgentPDFPreview(data: data, highlights: metadata?.highlights ?? [], session: coordinator)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onReceive(NotificationCenter.default.publisher(for: .PDFViewSelectionChanged)) { notification in
            guard notification.object as? PDFView === coordinator.view else { return }
            Task { @MainActor in
                await Task.yield()
                coordinator.hasSelection = !coordinator.selectedHighlights(color: color).isEmpty
            }
        }
        .accessibilityLabel(node.label ?? "PDF")
    }
}
