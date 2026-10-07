#if os(macOS)
import AppKit
import Foundation

struct XgentFileApplication: Codable, Sendable {
    let id: String
    let label: String
}

struct XgentFileApplicationsReply: Codable, Sendable {
    let applications: [XgentFileApplication]
    let error: String?
}

enum XgentWorkspaceFileApplications {
    @MainActor static func discover(_ path: String) -> XgentFileApplicationsReply {
        guard path.hasPrefix("/"),
              let attributes = try? FileManager.default.attributesOfItem(atPath: path),
              (attributes[.type] as? FileAttributeType) == .typeRegular else {
            return .init(applications: [], error: "Application discovery requires an existing absolute regular file")
        }
        var seen = Set<String>()
        let applications = NSWorkspace.shared.urlsForApplications(toOpen: URL(fileURLWithPath: path)).compactMap { application -> XgentFileApplication? in
            let url = application.standardizedFileURL
            guard url.isFileURL else { return nil }
            let id = "macos:" + url.absoluteString
            guard seen.insert(id).inserted else { return nil }
            return XgentFileApplication(id: id, label: FileManager.default.displayName(atPath: url.path))
        }
        return .init(applications: applications, error: nil)
    }

    static func query(_ path: String) -> XgentFileApplicationsReply {
        if Thread.isMainThread { return MainActor.assumeIsolated { discover(path) } }
        return DispatchQueue.main.sync { MainActor.assumeIsolated { discover(path) } }
    }
}
#endif
