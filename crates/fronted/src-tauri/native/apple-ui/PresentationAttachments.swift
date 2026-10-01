import SwiftUI
import Foundation
import ImageIO
import Nuke
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

@MainActor
struct XgentAttachmentOwner {
    let id = UUID()
    let node: XgentNode
    let document: XgentDocument
    let option: String

    @MainActor func isCurrent(in model: XgentPresentationModel) -> Bool {
        guard let action = node.action,
              let current = model.documents.first(where: { $0.surface == document.surface })?.node(id: node.id),
              current.kind == .filePicker, current.action == action, current.disabled != true else { return false }
        if let options = current.options {
            guard let choice = options.first(where: { $0.value == option }), choice.disabled != true else { return false }
        }
        return true
    }

    @MainActor func send(_ files: [[String: String]], in model: XgentPresentationModel) throws {
        guard isCurrent(in: model) else { throw AttachmentError.destination }
        guard !files.isEmpty else { return }
        let data = try JSONSerialization.data(withJSONObject: files)
        model.send(node, in: document, value: .string(String(decoding: data, as: UTF8.self)))
    }
}

private struct XgentAttachmentBatch: Sendable {
    var files: [[String: String]] = []
    var failures: [String] = []

    mutating func append(_ label: String, _ operation: () throws -> [String: String]) throws {
        do { files.append(try operation()) }
        catch {
            if XgentAttachmentPayload.isCancellation(error) { throw error }
            failures.append("\(label): \(error.localizedDescription)")
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
    @State private var fileOwner: XgentAttachmentOwner?
    @State private var photoOwner: XgentAttachmentOwner?
    @State private var importID: UUID?
    @State private var importTask: Task<Void, Never>?
    #if os(iOS)
    @State private var takingPhoto = false
    @State private var cameraOwner: XgentAttachmentOwner?
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
                Button {
                    guard let owner = capture("photos") else { return }
                    photoOwner = owner
                    pickingPhotos = true
                } label: { Label(label("photos", "Photos"), systemImage: "photo.on.rectangle") }
                    .disabled(disabled("photos"))
            }
            if includes("files") {
                Button {
                    guard let owner = capture("files") else { return }
                    fileOwner = owner
                    pickingFiles = true
                } label: { Label(label("files", "Files"), systemImage: "folder") }
                    .disabled(disabled("files"))
            }
            if !(node.children ?? []).isEmpty {
                Divider()
                XgentNativeMenuItems(nodes: node.children ?? [], document: document, model: model)
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
        .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true,
                      onCompletion: { result in
            guard let owner = fileOwner else { return }
            fileOwner = nil
            startImport(owner) {
                let urls = try result.get()
                return try await XgentAttachmentPayload.prepare {
                    guard urls.count <= 9 else { throw AttachmentError.limit }
                    var batch = XgentAttachmentBatch()
                    for url in urls {
                        try Task.checkCancellation()
                        try batch.append(url.lastPathComponent) { try XgentAttachmentPayload.file(url) }
                    }
                    return batch
                }
            }
        }, onCancellation: { fileOwner = nil })
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: 9,
                      matching: .images, preferredItemEncoding: .current)
        .onChange(of: photos) { _, selection in
            guard !selection.isEmpty else { return }
            let owner = photoOwner
            photoOwner = nil
            photos = []
            guard let owner else { return }
            startImport(owner) {
                var batch = XgentAttachmentBatch()
                for (index, item) in selection.enumerated() {
                    try Task.checkCancellation()
                    do {
                        guard let data = try await item.loadTransferable(type: Data.self) else { throw AttachmentError.unavailable }
                        let payload = try await XgentAttachmentPayload.prepare {
                            try XgentAttachmentPayload.photo(data, name: "photo-\(UUID().uuidString)")
                        }
                        batch.files.append(payload)
                    } catch {
                        if XgentAttachmentPayload.isCancellation(error) { throw error }
                        batch.failures.append("Photo \(index + 1): \(error.localizedDescription)")
                    }
                }
                return batch
            }
        }
        .onChange(of: node.action) { _, _ in cancelSelection() }
        .onChange(of: node.disabled) { _, disabled in if disabled == true { cancelSelection() } }
        #if os(iOS)
        .fullScreenCover(isPresented: $takingPhoto, onDismiss: { cameraOwner = nil }) {
            let owner = cameraOwner
            XgentCamera { data in
                takingPhoto = false
                cameraOwner = nil
                guard let data, let owner else { return }
                startImport(owner) {
                    let payload = try await XgentAttachmentPayload.prepare {
                        try XgentAttachmentPayload.photo(data, name: "camera-\(UUID().uuidString)")
                    }
                    return XgentAttachmentBatch(files: [payload])
                }
            }.ignoresSafeArea()
        }
        #endif
    }

    private func capture(_ option: String) -> XgentAttachmentOwner? {
        guard !importing, !pickingFiles, !pickingPhotos else { return nil }
        #if os(iOS)
        guard cameraOwner == nil else { return nil }
        #endif
        let owner = XgentAttachmentOwner(node: node, document: document, option: option)
        guard owner.isCurrent(in: model) else { return nil }
        fileOwner = nil
        photoOwner = nil
        return owner
    }

    private func startImport(_ owner: XgentAttachmentOwner,
                             operation: @escaping @MainActor () async throws -> XgentAttachmentBatch) {
        guard !importing, owner.isCurrent(in: model) else { return }
        importing = true
        importID = owner.id
        importTask = Task { @MainActor in
            defer {
                if importID == owner.id {
                    importing = false
                    importID = nil
                    importTask = nil
                }
            }
            do {
                try Task.checkCancellation()
                let batch = try await operation()
                try Task.checkCancellation()
                guard importID == owner.id else { return }
                try owner.send(batch.files, in: model)
                if !batch.failures.isEmpty { model.error = batch.failures.joined(separator: "\n") }
            } catch {
                if importID == owner.id, owner.isCurrent(in: model),
                   !XgentAttachmentPayload.isCancellation(error) { model.error = error.localizedDescription }
            }
        }
    }

    private func cancelSelection() {
        importTask?.cancel()
        importTask = nil
        importID = nil
        importing = false
        fileOwner = nil
        photoOwner = nil
        pickingFiles = false
        pickingPhotos = false
        photos = []
        #if os(iOS)
        cameraOwner = nil
        takingPhoto = false
        #endif
    }

    #if os(iOS)
    private func requestCamera() {
        guard let owner = capture("camera") else { return }
        cameraOwner = owner
        AVCaptureDevice.requestAccess(for: .video) { allowed in
            DispatchQueue.main.async {
                guard cameraOwner?.id == owner.id else { return }
                guard owner.isCurrent(in: model) else { cameraOwner = nil; return }
                if allowed { takingPhoto = true }
                else {
                    cameraOwner = nil
                    model.error = "Camera access is disabled. Enable it in system settings."
                }
            }
        }
    }
    #endif
}

enum XgentAttachmentPayload {
    static let maximumBytes = 20 * 1024 * 1024
    static let maximumPhotoSourceBytes = 100 * 1024 * 1024

    nonisolated static func prepare<T: Sendable>(_ operation: @escaping @Sendable () throws -> T) async throws -> T {
        try Task.checkCancellation()
        let worker = Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            return try operation()
        }
        return try await withTaskCancellationHandler(operation: {
            let result = try await worker.value
            try Task.checkCancellation()
            return result
        }, onCancel: { worker.cancel() })
    }

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
                // Files retain their original encoding; chat normalizes images after decoding this payload.
                return try payload(data, name: url.lastPathComponent, type: type)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw AttachmentError.unavailable }
        return try result.get()
    }

    nonisolated static func photo(_ data: Data, name: String) throws -> [String: String] {
        // PhotosUI may return a large original. Bound source memory, then
        // downsample before enforcing the smaller transport payload limit.
        guard data.count <= maximumPhotoSourceBytes else { throw AttachmentError.photoSourceSize }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let identifier = CGImageSourceGetType(source),
              let type = UTType(identifier as String), type.conforms(to: .image),
              CGImageSourceGetCount(source) > 0 else { throw AttachmentError.unavailable }
        let base = (name as NSString).deletingPathExtension
        let supported = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon"]
        if data.count <= maximumBytes,
           let mime = type.preferredMIMEType, supported.contains(mime) {
            return try payload(data, name: "\(base).\(type.preferredFilenameExtension ?? "jpg")", type: type)
        }
        var pixels: Float = 2048
        while pixels >= 1 {
            try Task.checkCancellation()
            guard let image = ImageRequest.ThumbnailOptions(maxPixelSize: pixels).makeThumbnail(with: data),
                  let jpeg = ImageEncoders.ImageIO(type: .jpeg, compressionRatio: 0.9).encode(image) else {
                throw AttachmentError.unavailable
            }
            if jpeg.count <= 5 * 1024 * 1024 {
                return try payload(jpeg, name: "\(base).jpg", type: .jpeg)
            }
            pixels /= 2
        }
        throw AttachmentError.size
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
    case limit, size, photoSourceSize, unavailable, destination
    var errorDescription: String? {
        switch self {
        case .limit: return "Select up to 9 files."
        case .size: return "Each attachment must be 20 MB or smaller."
        case .photoSourceSize: return "The selected photo is too large to process (100 MB maximum)."
        case .unavailable: return "The selected photo could not be loaded."
        case .destination: return "The attachment destination changed. Select the files again."
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
