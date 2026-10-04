import Foundation

// A FileProvider grants access to the original URL, not to a reconstructed path.
// Keep that URL alive for precisely as long as the mounted workspace needs it.
final class IOSWorkspaceAccessLease {
    let url: URL
    private let release: (URL) -> Void

    init(url: URL, operations: IOSWorkspaceFileOperations) throws {
        guard operations.startAccess(url) else {
            throw MobileExecutionError.invalidRequest("Could not retain access to the selected workspace")
        }
        self.url = url
        release = operations.stopAccess
    }

    deinit { release(url) }
}

// FileProvider operations are injectable for lifecycle/rollback regressions.
// Production uses Foundation's real bookmark and security-scope APIs.
struct IOSWorkspaceFileOperations {
    var startAccess: (URL) -> Bool
    var stopAccess: (URL) -> Void
    var canonicalize: (URL) -> URL
    var bookmark: (URL) throws -> Data
    var resolve: (Data) throws -> (url: URL, stale: Bool)
    var persist: (Data, URL) throws -> Void

    static let live = Self(
        startAccess: { $0.startAccessingSecurityScopedResource() },
        stopAccess: { $0.stopAccessingSecurityScopedResource() },
        canonicalize: { $0.resolvingSymlinksInPath().standardizedFileURL },
        bookmark: { try $0.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) },
        resolve: {
            var stale = false
            let url = try URL(resolvingBookmarkData: $0, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
            return (url, stale)
        },
        persist: { data, url in
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        }
    )
}
