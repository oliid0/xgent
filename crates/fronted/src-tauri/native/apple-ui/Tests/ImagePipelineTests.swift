import CoreGraphics
import Foundation
import ImageIO
import Nuke
import UniformTypeIdentifiers
import XCTest
@testable import XgentNativeUI

func nativeImageFixture(width: Int = 640, height: Int = 480, type: UTType = .png, orientation: Int = 1) throws -> Data {
    let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
    context.setFillColor(CGColor(red: 0.08, green: 0.45, blue: 0.85, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
    context.setFillColor(CGColor(red: 0.9, green: 0.4, blue: 0.15, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: CGFloat(width) / 3, height: CGFloat(height)))
    let output = NSMutableData()
    let destination = try XCTUnwrap(CGImageDestinationCreateWithData(output as CFMutableData, type.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, try XCTUnwrap(context.makeImage()),
        [kCGImagePropertyOrientation: orientation] as CFDictionary)
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    return output as Data
}

func nativeImageDimensions(_ data: Data) throws -> (Int, Int) {
    let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
    let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
    return (try XCTUnwrap(properties[kCGImagePropertyPixelWidth] as? NSNumber).intValue,
            try XCTUnwrap(properties[kCGImagePropertyPixelHeight] as? NSNumber).intValue)
}

final class ImagePipelineTests: XCTestCase {
    @MainActor
    func testEquivalentInlineEncodingsReuseTheActualImageCache() async throws {
        let data = try nativeImageFixture()
        let raw = try await XgentImageRequests.prepare(data.base64EncodedString(), maximumPixelSize: 300)
        let url = try await XgentImageRequests.prepare("data:image/png;base64,\(data.base64EncodedString())", maximumPixelSize: 300)
        XCTAssertEqual(raw.imageID, url.imageID)
        XCTAssertNil(raw.url)
        XCTAssertTrue(raw.options.contains(.disableDiskCache))
        _ = try await XgentImageRequests.pipeline.image(for: raw)
        XCTAssertNotNil(XgentImageRequests.pipeline.cache[url], "Equivalent content must find the cached thumbnail")
    }

    @MainActor
    func testLargeImagesDecodeAtTheRequestedThumbnailSize() async throws {
        let data = try nativeImageFixture(width: 4096, height: 3072)
        let request = try await XgentImageRequests.prepare(data.base64EncodedString(), maximumPixelSize: 320)
        let image = try await XgentImageRequests.pipeline.image(for: request)
        let encoded = try XCTUnwrap(ImageEncoders.ImageIO(type: .png).encode(image))
        let size = try nativeImageDimensions(encoded)
        XCTAssertEqual(size.0, 320)
        XCTAssertEqual(size.1, 240)
    }

    @MainActor
    func testResizedRequestsDecodeAgainAndApplySourceOrientation() async throws {
        let data = try nativeImageFixture(width: 1600, height: 800, type: .tiff, orientation: 6)
        let small = try await XgentImageRequests.prepare(data.base64EncodedString(), maximumPixelSize: 200)
        let large = try await XgentImageRequests.prepare(data.base64EncodedString(), maximumPixelSize: 400)
        XCTAssertNotEqual(small.imageID, large.imageID)
        let image = try await XgentImageRequests.pipeline.image(for: large)
        let size = try nativeImageDimensions(XCTUnwrap(ImageEncoders.ImageIO(type: .png).encode(image)))
        XCTAssertEqual(size.0, 200)
        XCTAssertEqual(size.1, 400)
    }

    @MainActor
    func testInvalidOversizedAndNonImageInputsFailWithoutAPlaceholderSuccess() async throws {
        for encoded in ["", "%%%", "data:image/png,not-base64", "https://example.invalid/photo.png",
                        String(repeating: "A", count: ((XgentImageRequests.maximumBytes + 2) / 3) * 4 + 4)] {
            do {
                _ = try await XgentImageRequests.prepare(encoded, maximumPixelSize: 300)
                XCTFail("Invalid or oversized inline data must fail")
            } catch {}
        }
        let invalid = try await XgentImageRequests.prepare(Data("not an image".utf8).base64EncodedString(), maximumPixelSize: 300)
        do {
            _ = try await XgentImageRequests.pipeline.image(for: invalid)
            XCTFail("The actual decoder must reject non-image data")
        } catch {}
        for pixels in [Float.nan, Float.infinity, Float(-1), Float(0)] {
            do {
                _ = try await XgentImageRequests.prepare(try nativeImageFixture().base64EncodedString(), maximumPixelSize: pixels)
                XCTFail("Invalid pixel budgets must fail")
            } catch {}
        }
    }

    @MainActor
    func testCancelledPreparationCannotDeliverAnImageRequest() async throws {
        let data = try nativeImageFixture().base64EncodedString()
        let task = Task { try await XgentImageRequests.prepare(data, maximumPixelSize: 300) }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("A cancelled preparation must not reach the image view")
        } catch is CancellationError {
        } catch { XCTFail("Expected cancellation, got \(error)") }
    }
}
