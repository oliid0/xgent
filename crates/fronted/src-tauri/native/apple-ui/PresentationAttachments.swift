import SwiftUI
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

    var body: some View {
        Menu {
            #if os(iOS)
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button { requestCamera() } label: { Label(label("camera", "Camera"), systemImage: "camera") }
            }
            #endif
            Button { pickingPhotos = true } label: { Label(label("photos", "Photos"), systemImage: "photo.on.rectangle") }
            Button { pickingFiles = true } label: { Label(label("files", "Files"), systemImage: "folder") }
        } label: {
            if importing { ProgressView().frame(width: 44, height: 44) }
            else { Image(systemName: "plus").font(.system(size: 20)).frame(width: 44, height: 44).contentShape(Circle()) }
        }
        .menuStyle(.borderlessButton).disabled(importing)
        .accessibilityLabel(node.label ?? "Attach files")
        .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            importing = true
            Task { @MainActor in
                defer { importing = false }
                do {
                    let urls = try result.get()
                    let files = try await Task.detached {
                        guard urls.count <= 9 else { throw AttachmentError.limit }
                        return try urls.map { url -> [String: String] in
                            let scoped = url.startAccessingSecurityScopedResource()
                            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                            guard size <= 20 * 1024 * 1024 else { throw AttachmentError.size }
                            return try Self.payload(Data(contentsOf: url), name: url.lastPathComponent,
                                type: UTType(filenameExtension: url.pathExtension) ?? .data)
                        }
                    }.value
                    try send(files)
                } catch { model.error = error.localizedDescription }
            }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: 9, matching: .images)
        .onChange(of: photos) { selection in
            guard !selection.isEmpty else { return }
            importing = true
            Task { @MainActor in
                defer { importing = false; photos = [] }
                do {
                    var files: [[String: String]] = []
                    for item in selection {
                        guard let data = try await item.loadTransferable(type: Data.self) else { throw AttachmentError.unavailable }
                        let type = item.supportedContentTypes.first ?? .image
                        files.append(try Self.payload(data, name: "photo-\(UUID().uuidString).\(type.preferredFilenameExtension ?? "jpg")", type: type))
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
                do { try send([Self.payload(data, name: "camera-\(UUID().uuidString).jpg", type: .jpeg)]) }
                catch { model.error = error.localizedDescription }
            }.ignoresSafeArea()
        }
        #endif
    }

    nonisolated private static func payload(_ data: Data, name: String, type: UTType) throws -> [String: String] {
        guard data.count <= 20 * 1024 * 1024 else { throw AttachmentError.size }
        return ["fileName": name, "mimeType": type.preferredMIMEType ?? "application/octet-stream", "contentBase64": data.base64EncodedString()]
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
