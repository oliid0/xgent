import Foundation
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum XgentClipboardAttachment: @unchecked Sendable {
    case file(URL)
    case bytes(Data, name: String, type: UTType)
    case providerFile(NSItemProvider)
    case providerData(NSItemProvider, type: UTType)

    static func providers(_ providers: [NSItemProvider]) -> [Self] {
        providers.compactMap { provider in
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                return .providerFile(provider)
            }
            let types = provider.registeredTypeIdentifiers.compactMap { UTType($0) }
            if let type = types.first(where: { $0.conforms(to: .image) }) {
                return .providerData(provider, type: type)
            }
            // Copying an ordinary web link or formatted text stays a text
            // paste. Documents exported as files retain their original bytes.
            if types.contains(where: { $0.conforms(to: .text) || $0.conforms(to: .url) }) { return nil }
            guard let type = types.first(where: { $0.conforms(to: .data) && $0 != .data }) else { return nil }
            return .providerData(provider, type: type)
        }
    }

    #if os(macOS)
    @MainActor static func pasteboard(_ pasteboard: NSPasteboard) -> [Self] {
        (pasteboard.pasteboardItems ?? []).compactMap { item in
            if let value = item.string(forType: .fileURL), let url = URL(string: value), url.isFileURL {
                return .file(url)
            }
            for raw in item.types {
                guard let type = UTType(raw.rawValue), type.conforms(to: .image) || type.conforms(to: .pdf),
                      let data = item.data(forType: raw) else { continue }
                return .bytes(data, name: "Clipboard.\(type.preferredFilenameExtension ?? "bin")", type: type)
            }
            return nil
        }
    }
    #endif

    nonisolated func payload() async throws -> [String: String] {
        switch self {
        case .file(let url):
            return try await XgentAttachmentPayload.prepare { try XgentAttachmentPayload.file(url) }
        case .bytes(let data, let name, let type):
            return try await Self.payload(data, name: name, type: type)
        case .providerFile(let provider):
            let url: URL = try await XgentClipboardLoad.load { completion in
                provider.loadObject(ofClass: NSURL.self) { object, error in
                    if let error { completion(.failure(error)); return }
                    guard let url = object as? NSURL, url.isFileURL else {
                        completion(.failure(XgentClipboardError.unavailable)); return
                    }
                    completion(.success(url as URL))
                }
            }
            return try await XgentAttachmentPayload.prepare { try XgentAttachmentPayload.file(url) }
        case .providerData(let provider, let type):
            let name = provider.suggestedName ?? "Clipboard.\(type.preferredFilenameExtension ?? "bin")"
            let data: Data = try await XgentClipboardLoad.load { completion in
                provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                    if let error { completion(.failure(error)); return }
                    guard let url else { completion(.failure(XgentClipboardError.unavailable)); return }
                    do {
                        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                        let limit = type.conforms(to: .image)
                            ? XgentAttachmentPayload.maximumPhotoSourceBytes : XgentAttachmentPayload.maximumBytes
                        guard size <= limit else { throw XgentClipboardError.size }
                        // The provider deletes this temporary file when the
                        // callback returns. Read it before resuming the task.
                        completion(.success(try Data(contentsOf: url)))
                    } catch { completion(.failure(error)) }
                }
            }
            return try await Self.payload(data, name: name, type: type)
        }
    }

    nonisolated private static func payload(_ data: Data, name: String, type: UTType) async throws -> [String: String] {
        try await XgentAttachmentPayload.prepare {
            if type.conforms(to: .image) { return try XgentAttachmentPayload.photo(data, name: name) }
            let filename = (name as NSString).pathExtension.isEmpty
                ? "\(name).\(type.preferredFilenameExtension ?? "bin")" : name
            return try XgentAttachmentPayload.payload(data, name: filename, type: type)
        }
    }
}

@MainActor final class XgentComposerClipboard: ObservableObject {
    private var task: Task<Void, Never>?
    private var request: UUID?

    func paste(_ sources: [XgentClipboardAttachment], input: XgentNode, document: XgentDocument,
               model: XgentPresentationModel) -> Bool {
        guard !sources.isEmpty else { return false }
        guard let target = input.children?.first(where: { $0.id == "draft-attachment-target" })?.text,
              let latest = model.documents.first(where: { $0.surface == document.surface }),
              let picker = latest.node(id: target), picker.kind == .filePicker,
              isCurrent(input, document: document, model: model) else { return false }
        let owner = XgentAttachmentOwner(node: picker, document: latest, option: "files")
        guard owner.isCurrent(in: model), !model.isBusy(picker, in: latest) else {
            model.error = XgentClipboardError.unavailable.localizedDescription
            return true
        }
        guard sources.count <= 9 else { model.error = XgentClipboardError.limit.localizedDescription; return true }
        cancel()
        let id = UUID(); request = id
        task = Task { [weak self, weak model] in
            var files: [[String: String]] = [], failures: [String] = []
            do {
                for source in sources {
                    try Task.checkCancellation()
                    guard let self, let model, self.request == id, owner.isCurrent(in: model),
                          self.isCurrent(input, document: document, model: model) else { return }
                    do { files.append(try await source.payload()) }
                    catch {
                        if XgentAttachmentPayload.isCancellation(error) { throw error }
                        failures.append(error.localizedDescription)
                    }
                }
                try Task.checkCancellation()
                guard let self, let model, self.request == id, owner.isCurrent(in: model),
                      self.isCurrent(input, document: document, model: model) else { return }
                try owner.send(files, in: model)
                if !failures.isEmpty { model.error = failures.joined(separator: "\n") }
            } catch {
                if !XgentAttachmentPayload.isCancellation(error), let self, let model, self.request == id,
                   owner.isCurrent(in: model), self.isCurrent(input, document: document, model: model) {
                    model.error = error.localizedDescription
                }
            }
            if self?.request == id { self?.task = nil; self?.request = nil }
        }
        return true
    }

    private func isCurrent(_ input: XgentNode, document: XgentDocument, model: XgentPresentationModel) -> Bool {
        guard let current = model.documents.first(where: { $0.surface == document.surface })?.node(id: input.id) else { return false }
        return current.kind == .composerInput && current.disabled != true && current.action == input.action &&
            current.editAction == input.editAction && current.selectionAction == input.selectionAction
    }

    func cancel() { request = nil; task?.cancel(); task = nil }
}

private enum XgentClipboardError: LocalizedError {
    case limit, size, unavailable
    var errorDescription: String? {
        switch self {
        case .limit: return "Paste up to 9 files."
        case .size: return "The clipboard attachment exceeds the supported size."
        case .unavailable: return "The clipboard attachment cannot be imported into this conversation."
        }
    }
}
