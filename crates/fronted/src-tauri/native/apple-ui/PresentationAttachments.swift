import SwiftUI
import Foundation
import ImageIO
import PhotosUI
import UniformTypeIdentifiers
#if os(iOS)
import AVFoundation
import UIKit
#endif

struct XgentGlassCircle: ViewModifier {
    var prominent = false
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(prominent ? Color.accentColor : Color.secondary.opacity(0.12), in: Circle())
        } else {
            #if compiler(>=6.2)
            if #available(iOS 26.0, macOS 26.0, *) {
                content.glassEffect(prominent ? .regular.tint(.accentColor).interactive() : .regular.interactive(), in: .circle)
                    .contentShape(Circle())
            } else {
                content.background(.regularMaterial, in: Circle())
                    .background(prominent ? Color.accentColor : Color.clear, in: Circle())
            }
            #else
            content.background(.regularMaterial, in: Circle())
                .background(prominent ? Color.accentColor : Color.clear, in: Circle())
            #endif
        }
    }
}

// System pickers feed the same attachment import action as all other renderers.
struct XgentAttachmentPicker: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    var controlSize: CGFloat = 44
    @State private var pickingFiles = false
    @State private var pickingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var importing = false
    #if os(iOS)
    @State private var takingPhoto = false
    #endif

    private func label(_ value: String, _ fallback: String) -> String {
        node.options?.first { $0.value == value }?.label ?? fallback
    }

    private func includes(_ value: String) -> Bool {
        node.options?.contains { $0.value == value } ?? true
    }

    private func disabled(_ value: String) -> Bool {
        node.options?.first { $0.value == value }?.disabled == true
    }

    var body: some View {
        Menu {
            #if os(iOS)
            if includes("camera") && UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button { requestCamera() } label: { Label(label("camera", "Camera"), systemImage: "camera") }
                    .disabled(disabled("camera"))
            }
            #endif
            if includes("photos") {
                Button { pickingPhotos = true } label: { Label(label("photos", "Photos"), systemImage: "photo.on.rectangle") }
                    .disabled(disabled("photos"))
            }
            if includes("files") {
                Button { pickingFiles = true } label: { Label(label("files", "Files"), systemImage: "folder") }
                    .disabled(disabled("files"))
            }
            if !(node.children ?? []).isEmpty {
                Divider()
                #if os(iOS)
                XgentIOSMenuItems(nodes: node.children ?? [], document: document, model: model)
                #else
                XgentNodeChildren(nodes: node.children ?? [], document: document, model: model)
                #endif
            }
        } label: {
            if importing { ProgressView().frame(width: controlSize, height: controlSize) }
            else {
                Image(systemName: "plus")
                    .font(.system(size: min(20, controlSize * 0.56)))
                    .frame(width: controlSize, height: controlSize)
                    .contentShape(Circle())
            }
        }
        .menuStyle(.borderlessButton).disabled(importing || node.disabled == true)
        .accessibilityLabel(node.label ?? "Attach files")
        .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            importing = true
            Task { @MainActor in
                defer { importing = false }
                do {
                    let urls = try result.get()
                    let files = try await Task.detached {
                        guard urls.count <= 9 else { throw AttachmentError.limit }
                        return try urls.map { try XgentAttachmentPayload.file($0) }
                    }.value
                    try send(files)
                } catch {
                    if !XgentAttachmentPayload.isCancellation(error) { model.error = error.localizedDescription }
                }
            }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: 9, matching: .images)
        .onChange(of: photos) { _, selection in
            guard !selection.isEmpty else { return }
            importing = true
            Task { @MainActor in
                defer { importing = false; photos = [] }
                do {
                    var files: [[String: String]] = []
                    for item in selection {
                        guard let data = try await item.loadTransferable(type: Data.self) else { throw AttachmentError.unavailable }
                        let payload = try await Task.detached {
                            try XgentAttachmentPayload.photo(data, name: "photo-\(UUID().uuidString)")
                        }.value
                        files.append(payload)
                    }
                    try send(files)
                } catch { model.error = error.localizedDescription }
            }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $takingPhoto) {
            XgentCamera { data in
                takingPhoto = false
                guard let data else { return }
                do { try send([XgentAttachmentPayload.photo(data, name: "camera-\(UUID().uuidString)")]) }
                catch { model.error = error.localizedDescription }
            }.ignoresSafeArea()
        }
        #endif
    }

    private func send(_ files: [[String: String]]) throws {
        guard !files.isEmpty else { return }
        let data = try JSONSerialization.data(withJSONObject: files)
        model.send(node, in: document, value: .string(String(decoding: data, as: UTF8.self)))
    }

    #if os(iOS)
    private func requestCamera() {
        AVCaptureDevice.requestAccess(for: .video) { allowed in
            DispatchQueue.main.async {
                if allowed { takingPhoto = true }
                else { model.error = "Camera access is disabled. Enable it in system settings." }
            }
        }
    }
    #endif
}

enum XgentAttachmentPayload {
    static let maximumBytes = 20 * 1024 * 1024

    nonisolated static func file(_ url: URL) throws -> [String: String] {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var coordinationError: NSError?
        var result: Result<[String: String], Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in
            result = Result {
                let values = try coordinatedURL.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey])
                guard values.isDirectory != true else { throw AttachmentError.unavailable }
                guard (values.fileSize ?? 0) <= maximumBytes else { throw AttachmentError.size }
                let data = try Data(contentsOf: coordinatedURL)
                let type = UTType(filenameExtension: url.pathExtension) ?? .data
                if type.conforms(to: .image), type.preferredMIMEType != "image/svg+xml" {
                    return try photo(data, name: url.lastPathComponent)
                }
                return try payload(data, name: url.lastPathComponent, type: type)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw AttachmentError.unavailable }
        return try result.get()
    }

    nonisolated static func photo(_ data: Data, name: String) throws -> [String: String] {
        guard data.count <= maximumBytes else { throw AttachmentError.size }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let identifier = CGImageSourceGetType(source),
              let type = UTType(identifier as String), type.conforms(to: .image),
              CGImageSourceGetCount(source) > 0 else { throw AttachmentError.unavailable }
        let base = (name as NSString).deletingPathExtension
        let supported = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon"]
        if let mime = type.preferredMIMEType, supported.contains(mime) {
            return try payload(data, name: "\(base).\(type.preferredFilenameExtension ?? "jpg")", type: type)
        }
        let jpeg = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(jpeg as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw AttachmentError.unavailable
        }
        CGImageDestinationAddImageFromSource(destination, source, 0,
            [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw AttachmentError.unavailable }
        return try payload(jpeg as Data, name: "\(base).jpg", type: .jpeg)
    }

    nonisolated static func payload(_ data: Data, name: String, type: UTType) throws -> [String: String] {
        guard data.count <= maximumBytes else { throw AttachmentError.size }
        return ["fileName": name, "mimeType": type.preferredMIMEType ?? "application/octet-stream", "contentBase64": data.base64EncodedString()]
    }

    nonisolated static func isCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? CocoaError)?.code == .userCancelled
    }
}

private enum AttachmentError: LocalizedError {
    case limit, size, unavailable
    var errorDescription: String? {
        switch self {
        case .limit: return "Select up to 9 files."
        case .size: return "Each attachment must be 20 MB or smaller."
        case .unavailable: return "The selected photo could not be loaded."
        }
    }
}

#if os(iOS)
private struct XgentCamera: UIViewControllerRepresentable {
    let completion: (Data?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(completion) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {
        context.coordinator.completion = completion
    }
    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        var completion: (Data?) -> Void
        init(_ completion: @escaping (Data?) -> Void) { self.completion = completion }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { completion(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            completion((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.9))
        }
    }
}
#endif
