#if os(macOS)
import Darwin
import Foundation

private func xgentFileApplicationJSON<T: Encodable>(_ result: T) -> UnsafeMutablePointer<CChar>? {
    guard let data = try? JSONEncoder().encode(result), let json = String(data: data, encoding: .utf8) else { return nil }
    return json.withCString { strdup($0) }
}

@_cdecl("xgent_workspace_file_applications")
public func xgentWorkspaceFileApplications(_ path: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let path, let decoded = String(validatingUTF8: path) else {
        return xgentFileApplicationJSON(XgentFileApplicationsReply(applications: [], error: "Invalid file path encoding"))
    }
    return xgentFileApplicationJSON(XgentWorkspaceFileApplications.query(decoded))
}

@_cdecl("xgent_workspace_file_application_open")
public func xgentWorkspaceFileApplicationOpen(_ path: UnsafePointer<CChar>?, _ application: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let path, let application, let decoded = String(validatingUTF8: path), let id = String(validatingUTF8: application) else {
        return xgentFileApplicationJSON(XgentFileApplicationOpenReply(ok: false, error: "Invalid file or application encoding"))
    }
    return xgentFileApplicationJSON(XgentWorkspaceFileApplicationOpen.open(decoded, applicationID: id))
}

// Each result is owned by the Rust caller, copied once, then released here.
@_cdecl("xgent_workspace_file_applications_free")
public func xgentWorkspaceFileApplicationsFree(_ pointer: UnsafeMutablePointer<CChar>?) { free(pointer) }
#endif
