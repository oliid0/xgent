import SwiftUI
import Foundation
import UniformTypeIdentifiers

struct XgentSkillBundlePicker: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var picking = false
    @State private var owner: XgentAttachmentOwner?
    @State private var importing = false
    @State private var operationID: UUID?
    @State private var task: Task<Void, Never>?

    var body: some View {
        Menu {
            ForEach(node.options ?? []) { option in
                Button(option.label) {
                    let destination = XgentAttachmentOwner(node: node, document: document, option: option.value)
                    guard !importing, destination.isCurrent(in: model) else { return }
                    owner = destination
                    picking = true
                }.disabled(option.disabled == true)
            }
        } label: {
            HStack(spacing: 8) {
                if importing { ProgressView().controlSize(.small) }
                else { Image(systemName: "folder.badge.plus") }
                Text(node.label ?? "Import skill")
            }
            .modifier(XgentControlTypography(node: node))
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(minHeight: 44)
            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        }
        .menuStyle(.borderlessButton)
        .disabled(importing || node.disabled == true)
        .fileImporter(isPresented: $picking,
                      allowedContentTypes: owner?.option == "folder" ? [.folder] : [.item],
                      allowsMultipleSelection: owner?.option != "folder",
                      onCompletion: read, onCancellation: { owner = nil })
        .onDisappear(perform: cancel)
        .onChange(of: node.action) { _, _ in cancel() }
        .onChange(of: node.disabled) { _, disabled in if disabled == true { cancel() } }
        .accessibilityIdentifier(node.id)
    }

    private func read(_ result: Result<[URL], Error>) {
        guard let destination = owner, destination.isCurrent(in: model) else { owner = nil; return }
        owner = nil
        importing = true
        operationID = destination.id
        task = Task { @MainActor in
            defer {
                if operationID == destination.id { importing = false; operationID = nil; task = nil }
            }
            do {
                let urls = try result.get()
                let files = try await XgentAttachmentPayload.prepare { try XgentSkillBundleReader.read(urls) }
                try Task.checkCancellation()
                guard operationID == destination.id else { return }
                try destination.send(files, in: model)
            } catch {
                if operationID == destination.id, destination.isCurrent(in: model),
                   !XgentAttachmentPayload.isCancellation(error) { model.error = error.localizedDescription }
            }
        }
    }

    private func cancel() {
        task?.cancel(); task = nil
        operationID = nil; importing = false; picking = false; owner = nil
    }
}

enum XgentSkillBundleReader {
    nonisolated static func read(_ urls: [URL]) throws -> [[String: String]] {
        var files: [[String: String]] = []
        var bytes = 0
        var paths = Set<String>()
        for url in urls {
            try Task.checkCancellation()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isSymbolicLink != true else { throw SkillBundleError.symbolicLink }
            if values.isDirectory == true {
                let root = url.standardizedFileURL.resolvingSymlinksInPath()
                var enumerationError: Error?
                guard let enumerator = FileManager.default.enumerator(at: root,
                    includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
                    options: [], errorHandler: { _, error in enumerationError = error; return false }) else {
                    throw SkillBundleError.unavailable
                }
                for case let file as URL in enumerator {
                    try Task.checkCancellation()
                    let attributes = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                    guard attributes.isSymbolicLink != true else { throw SkillBundleError.symbolicLink }
                    guard attributes.isRegularFile == true else { continue }
                    let resolved = file.standardizedFileURL.resolvingSymlinksInPath()
                    guard resolved.path.hasPrefix(root.path + "/") else { throw SkillBundleError.symbolicLink }
                    let relative = String(resolved.path.dropFirst(root.path.count + 1))
                    try append(file, path: root.lastPathComponent + "/" + relative, files: &files, bytes: &bytes, paths: &paths)
                }
                if let enumerationError { throw enumerationError }
            } else {
                try append(url, path: url.lastPathComponent, files: &files, bytes: &bytes, paths: &paths)
            }
        }
        guard !files.isEmpty else { throw SkillBundleError.unavailable }
        return files
    }

    nonisolated private static func append(_ url: URL, path: String, files: inout [[String: String]],
                                          bytes: inout Int, paths: inout Set<String>) throws {
        guard files.count < 512 else { throw SkillBundleError.limit }
        guard paths.insert(path).inserted else { throw SkillBundleError.duplicate }
        var coordinationError: NSError?
        var content: Result<Data, Error>?
        let remaining = 32 * 1024 * 1024 - bytes
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinated in
            content = Result {
                let values = try coordinated.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
                guard values.isRegularFile == true, values.isSymbolicLink != true else { throw SkillBundleError.unavailable }
                guard (values.fileSize ?? 0) <= remaining else { throw SkillBundleError.size }
                let data = try Data(contentsOf: coordinated)
                guard data.count <= remaining else { throw SkillBundleError.size }
                return data
            }
        }
        if let coordinationError { throw coordinationError }
        guard let content else { throw SkillBundleError.unavailable }
        let data = try content.get()
        bytes += data.count
        files.append(["path": path, "contentBase64": data.base64EncodedString(),
                      "mimeType": UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"])
    }
}

private enum SkillBundleError: LocalizedError {
    case limit, size, unavailable, symbolicLink, duplicate
    var errorDescription: String? {
        switch self {
        case .limit: return "A skill folder can contain at most 512 files."
        case .size: return "A skill bundle can contain at most 32 MiB."
        case .unavailable: return "The selected skill files could not be read."
        case .symbolicLink: return "Select a skill folder containing regular files without symbolic links."
        case .duplicate: return "The selected skill files contain duplicate relative paths."
        }
    }
}
