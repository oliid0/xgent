import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import XgentNativeUI

final class AttachmentPayloadTests: XCTestCase {
    private let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=")!

    func testPhotoTypeComesFromBytesAndPreservesSupportedEncoding() throws {
        let payload = try XgentAttachmentPayload.photo(png, name: "photo.heic")
        XCTAssertEqual(payload["fileName"], "photo.png")
        XCTAssertEqual(payload["mimeType"], "image/png")
        XCTAssertEqual(payload["contentBase64"], png.base64EncodedString())
    }

    func testUnsupportedPhotoEncodingConvertsToReadableJPEG() throws {
        let source = try XCTUnwrap(CGImageSourceCreateWithData(png as CFData, nil))
        let tiff = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(tiff as CFMutableData, UTType.tiff.identifier as CFString, 1, nil))
        CGImageDestinationAddImageFromSource(destination, source, 0, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let payload = try XgentAttachmentPayload.photo(tiff as Data, name: "photo.tiff")
        XCTAssertEqual(payload["fileName"], "photo.jpg")
        XCTAssertEqual(payload["mimeType"], "image/jpeg")
        let jpeg = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(payload["contentBase64"])))
        let encoded = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(encoded) as String?, UTType.jpeg.identifier)
    }

    func testCoordinatedFilesKeepDocumentBytesAndReadableImageMetadata() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let text = Data("Workspace attachment".utf8)
        let document = directory.appendingPathComponent("note.txt")
        try text.write(to: document)
        XCTAssertEqual(try XgentAttachmentPayload.file(document)["contentBase64"], text.base64EncodedString())
        let photo = directory.appendingPathComponent("photo.heic")
        try png.write(to: photo)
        let payload = try XgentAttachmentPayload.file(photo)
        XCTAssertEqual(payload["fileName"], "photo.png")
        XCTAssertEqual(payload["mimeType"], "image/png")
        let svg = directory.appendingPathComponent("icon.svg")
        let svgBytes = Data("<svg xmlns=\"http://www.w3.org/2000/svg\"/>".utf8)
        try svgBytes.write(to: svg)
        XCTAssertEqual(try XgentAttachmentPayload.file(svg)["contentBase64"], svgBytes.base64EncodedString())
        XCTAssertThrowsError(try XgentAttachmentPayload.file(directory))
    }

    func testInvalidOversizedAndCancelledSelectionsHaveDistinctOutcomes() throws {
        XCTAssertThrowsError(try XgentAttachmentPayload.photo(Data("invalid".utf8), name: "photo"))
        XCTAssertThrowsError(try XgentAttachmentPayload.payload(
            Data(count: XgentAttachmentPayload.maximumBytes + 1), name: "large.txt", type: .plainText))
        XCTAssertTrue(XgentAttachmentPayload.isCancellation(CancellationError()))
        XCTAssertTrue(XgentAttachmentPayload.isCancellation(CocoaError(.userCancelled)))
        XCTAssertFalse(XgentAttachmentPayload.isCancellation(CocoaError(.fileReadNoSuchFile)))
    }
}
