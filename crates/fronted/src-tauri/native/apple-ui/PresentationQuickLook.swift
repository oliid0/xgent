import SwiftUI
#if os(iOS)
import UIKit
import QuickLook
#else
import AppKit
import QuickLookUI
#endif

#if os(iOS)
private struct XgentQuickLookController: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.url = url
        controller.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}

#else
private struct XgentQuickLookController: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context) -> QLPreviewView {
        let view = QLPreviewView(frame: .zero, style: .normal)!
        view.shouldCloseWithWindow = false
        view.autostarts = true
        view.previewItem = url as NSURL
        return view
    }
    func updateNSView(_ view: QLPreviewView, context: Context) {
        guard (view.previewItem as? NSURL) != url as NSURL else { return }
        view.previewItem = url as NSURL
        view.refreshPreviewItem()
    }
    static func dismantleNSView(_ view: QLPreviewView, coordinator: ()) {
        view.previewItem = nil
        view.close()
    }
}
#endif

struct XgentQuickLookPreview: View {
    let data: Data
    let mimeType: String
    let label: String
    @State private var temporaryURL: URL?
    @State private var failure: String?

    private var fileExtension: String {
        if mimeType == "text/html" { return "html" }
        if mimeType == "application/pdf" { return "pdf" }
        return URL(fileURLWithPath: label).pathExtension
    }

    var body: some View {
        Group {
            if let failure {
                Label(failure, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            } else if let temporaryURL {
                XgentQuickLookController(url: temporaryURL)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(label)
        .task(id: data) {
            if let temporaryURL { try? FileManager.default.removeItem(at: temporaryURL) }
            temporaryURL = nil
            failure = nil
            let suffix = fileExtension
            let bytes = data
            let write = Task.detached(priority: .userInitiated) {
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension(suffix)
                do {
                    try Task.checkCancellation()
                    try bytes.write(to: url, options: .atomic)
                    try Task.checkCancellation()
                    return url
                } catch {
                    try? FileManager.default.removeItem(at: url)
                    throw error
                }
            }
            do {
                let url = try await withTaskCancellationHandler(operation: { try await write.value }, onCancel: { write.cancel() })
                guard !Task.isCancelled else {
                    try? FileManager.default.removeItem(at: url)
                    return
                }
                #if os(iOS)
                guard QLPreviewController.canPreview(url as NSURL) else {
                    try? FileManager.default.removeItem(at: url)
                    failure = "This file type cannot be previewed."
                    return
                }
                #endif
                temporaryURL = url
                failure = nil
            } catch {
                if !Task.isCancelled { failure = error.localizedDescription }
            }
        }
        .onDisappear {
            if let temporaryURL { try? FileManager.default.removeItem(at: temporaryURL) }
            temporaryURL = nil
        }
    }
}
