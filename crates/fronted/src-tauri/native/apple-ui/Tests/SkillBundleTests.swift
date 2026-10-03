import Foundation
import XCTest
@testable import XgentNativeUI

final class SkillBundleTests: XCTestCase {
    func testFolderImportPreservesHierarchyAndBinaryResources() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("skill-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("assets"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("# Skill instructions".utf8).write(to: root.appendingPathComponent("SKILL.md"))
        try Data([0, 255, 128]).write(to: root.appendingPathComponent("assets/icon.bin"))
        let files = try XgentSkillBundleReader.read([root])
        XCTAssertEqual(Set(files.compactMap { $0["path"] }), Set([root.lastPathComponent + "/SKILL.md", root.lastPathComponent + "/assets/icon.bin"]))
        let icon = try XCTUnwrap(files.first { $0["path"]?.hasSuffix("/assets/icon.bin") == true })
        XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(icon["contentBase64"])), Data([0, 255, 128]))
    }

    func testDuplicatesAndSymbolicLinksAreRejectedWithoutPartialImport() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("skill-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("SKILL.md")
        try Data("# Instructions".utf8).write(to: file)
        XCTAssertThrowsError(try XgentSkillBundleReader.read([file, file]))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("link.md"), withDestinationURL: file)
        XCTAssertThrowsError(try XgentSkillBundleReader.read([root]))
    }

    func testCombinedByteAndFileCountLimits() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("skill-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let large = root.appendingPathComponent("large.bin")
        try Data(repeating: 0, count: 32 * 1024 * 1024 + 1).write(to: large)
        XCTAssertThrowsError(try XgentSkillBundleReader.read([large]))
        try FileManager.default.removeItem(at: large)
        for index in 0..<513 { try Data().write(to: root.appendingPathComponent("\(index).md")) }
        XCTAssertThrowsError(try XgentSkillBundleReader.read([root]))
    }
}
