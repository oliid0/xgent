#if os(macOS)
import AppKit
import Darwin
import Foundation
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class WorkspaceFileApplicationTests: XCTestCase {
    @MainActor func testNativeMenuPreloadsAgainWhenWorkspaceSurfaceChangesWithTheSameFilename() async throws {
        func fixture(_ surface: String) throws -> XgentDocument {
            let payload: [String: Any] = ["version": 1, "surface": surface, "revision": 1, "mode": "root", "title": "File", "appearance": "system", "nodes": [
                ["id": "workspace-file-open", "kind": "Menu", "variant": "workspace-file-open", "label": "使用其他应用打开", "text": "a.txt", "action": "open", "options": [
                    ["value": "open", "label": "Default application"], ["value": "$refresh", "label": "Refresh available applications"]]]]]
            let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
            try document.validate()
            return document
        }
        let first = try fixture("first-workspace"), second = try fixture("second-workspace")
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { action in
            actions.append(action)
            model.complete(XgentActionResult(surface: action.surface, requestId: action.requestId, ok: true, error: nil))
        }
        model.update(first)
        let host = NSHostingView(rootView: XgentWorkspaceFileOpenMenu(node: try XCTUnwrap(first.node(id: "workspace-file-open")), document: first, model: model))
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 360, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { model.invalidate(); window.close() }
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(actions.map(\.surface), [first.surface])
        XCTAssertEqual(actions.first?.value.text, "$refresh")
        model.update(second)
        host.rootView = XgentWorkspaceFileOpenMenu(node: try XCTUnwrap(second.node(id: "workspace-file-open")), document: second, model: model)
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(actions.map(\.surface), [first.surface, second.surface])
        XCTAssertEqual(actions.last?.value.text, "$refresh")
    }

    @MainActor func testDiscoveryMatchesInstalledHandlersForUnicodeFileAndWorkerCalls() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xgent-file-applications-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("报告与图像 😀.txt")
        try Data("Native file application discovery".utf8).write(to: file)
        var seen = Set<String>()
        let expected = NSWorkspace.shared.urlsForApplications(toOpen: file).map { "macos:" + $0.standardizedFileURL.absoluteString }
            .filter { seen.insert($0).inserted }
        let reply = XgentWorkspaceFileApplications.discover(file.path)
        XCTAssertNil(reply.error)
        XCTAssertEqual(reply.applications.map(\.id), expected)
        XCTAssertTrue(reply.applications.allSatisfy { !$0.label.isEmpty })
        let path = file.path
        let worker = await Task.detached { XgentWorkspaceFileApplications.query(path) }.value
        XCTAssertNil(worker.error)
        XCTAssertEqual(worker.applications.map(\.id), expected)
        let bridged: XgentFileApplicationsReply = try await Task.detached {
            try path.withCString { try Self.decodeOwned(xgentWorkspaceFileApplications($0)) }
        }.value
        XCTAssertNil(bridged.error)
        XCTAssertEqual(bridged.applications.map(\.id), expected)
    }

    @MainActor func testInvalidFilesAndUnregisteredApplicationCannotLaunch() async throws {
        XCTAssertNotNil(XgentWorkspaceFileApplications.discover("relative.txt").error)
        XCTAssertNotNil(XgentWorkspaceFileApplications.discover(FileManager.default.temporaryDirectory.path).error)
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("xgent-handler-" + UUID().uuidString + ".txt")
        try Data("Do not launch an application".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let main = XgentWorkspaceFileApplicationOpen.open(file.path, applicationID: "macos:file:///does-not-exist.app/")
        XCTAssertFalse(main.ok)
        XCTAssertTrue(main.error?.contains("filesystem worker") == true)
        let path = file.path
        let rejected = await Task.detached {
            XgentWorkspaceFileApplicationOpen.open(path, applicationID: "macos:file:///does-not-exist.app/")
        }.value
        XCTAssertFalse(rejected.ok)
        XCTAssertNotNil(rejected.error)
        try FileManager.default.removeItem(at: file)
        XCTAssertNotNil(XgentWorkspaceFileApplications.discover(path).error)
    }

    func testBridgeReturnsOwnedErrorsForInvalidEncodingAndNullArguments() throws {
        let nilPath: XgentFileApplicationsReply = try Self.decodeOwned(xgentWorkspaceFileApplications(nil))
        XCTAssertNotNil(nilPath.error)
        XCTAssertTrue(nilPath.applications.isEmpty)
        let nilOpen: XgentFileApplicationOpenReply = try Self.decodeOwned(xgentWorkspaceFileApplicationOpen(nil, nil))
        XCTAssertFalse(nilOpen.ok)
        XCTAssertNotNil(nilOpen.error)
        let invalid: [CChar] = [-1, 0]
        let invalidReply: XgentFileApplicationsReply = try invalid.withUnsafeBufferPointer {
            try Self.decodeOwned(xgentWorkspaceFileApplications($0.baseAddress))
        }
        XCTAssertNotNil(invalidReply.error)
        // Matching deallocation also accepts a null pointer, as Rust's adapter does.
        xgentWorkspaceFileApplicationsFree(nil)
    }

    private static func decodeOwned<T: Decodable>(_ pointer: UnsafeMutablePointer<CChar>?) throws -> T {
        let pointer = try XCTUnwrap(pointer)
        let data = Data(bytes: pointer, count: strlen(pointer))
        xgentWorkspaceFileApplicationsFree(pointer)
        return try JSONDecoder().decode(T.self, from: data)
    }
}
#endif
