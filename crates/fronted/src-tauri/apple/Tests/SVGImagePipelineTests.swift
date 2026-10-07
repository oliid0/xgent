import CoreGraphics
import Foundation
import ImageIO
import Nuke
import XCTest
@testable import XgentNativeUI

func nativeSVGFixture(width: Int = 100, height: Int = 100, contents: String? = nil) -> Data {
    let body = contents ?? """
    <rect width="\(width)" height="\(height / 5)" fill="#ff0000"/>
    <rect y="\(height * 4 / 5)" width="\(width)" height="\(height / 5)" fill="#0000ff"/>
    """
    return Data("""
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(width) \(height)">
    \(body)
    </svg>
    """.utf8)
}

private func imagePixel(_ data: Data, x: Int, y: Int) throws -> [UInt8] {
    let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
    let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
    let pixel = try XCTUnwrap(image.cropping(to: CGRect(x: CGFloat(x), y: CGFloat(y), width: 1, height: 1)))
    let context = try XCTUnwrap(CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8,
        bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue).union(.byteOrder32Big)))
    context.clear(CGRect(x: 0, y: 0, width: 1, height: 1))
    context.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    let bytes = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
    return Array(UnsafeBufferPointer(start: bytes, count: 4))
}

final class SVGImagePipelineTests: XCTestCase {
    @MainActor
    func testSVGBytesUseTheActualImagePipelineCacheAndPreserveAspectRatio() async throws {
        let data = nativeSVGFixture(width: 8000, height: 2000)
        let raw = try await XgentImageRequests.prepare(data.base64EncodedString(), maximumPixelSize: 320)
        let url = try await XgentImageRequests.prepare("data:image/svg+xml;base64,\(data.base64EncodedString())", maximumPixelSize: 320)
        XCTAssertEqual(raw.imageID, url.imageID)
        let image = try await XgentImageRequests.pipeline.image(for: raw)
        let png = try XCTUnwrap(ImageEncoders.ImageIO(type: .png).encode(image))
        let size = try nativeImageDimensions(png)
        XCTAssertEqual(size.0, 320)
        XCTAssertEqual(size.1, 80)
        XCTAssertNotNil(XgentImageRequests.pipeline.cache[url])
    }

    @MainActor
    func testSVGPreviewHasCorrectTopLeftCoordinatesAndTransparency() async throws {
        let request = try await XgentImageRequests.prepare(nativeSVGFixture().base64EncodedString(), maximumPixelSize: 100)
        let image = try await XgentImageRequests.pipeline.image(for: request)
        let png = try XCTUnwrap(ImageEncoders.ImageIO(type: .png).encode(image))
        XCTAssertEqual(try imagePixel(png, x: 50, y: 10), [255, 0, 0, 255])
        XCTAssertEqual(try imagePixel(png, x: 50, y: 90), [0, 0, 255, 255])
        XCTAssertEqual(try imagePixel(png, x: 50, y: 50), [0, 0, 0, 0])
    }

    @MainActor
    func testZoomRedrawsSmallVectorsAndLargeCanvasesStayWithinThePixelBudget() async throws {
        let data = nativeSVGFixture(width: 12, height: 6).base64EncodedString()
        let small = try await XgentImageRequests.prepare(data, maximumPixelSize: 50)
        let large = try await XgentImageRequests.prepare(data, maximumPixelSize: 400)
        XCTAssertNotEqual(small.imageID, large.imageID)
        for (request, width, height) in [(small, 50, 25), (large, 400, 200)] {
            let image = try await XgentImageRequests.pipeline.image(for: request)
            let size = try nativeImageDimensions(XCTUnwrap(ImageEncoders.ImageIO(type: .png).encode(image)))
            XCTAssertEqual(size.0, width)
            XCTAssertEqual(size.1, height)
        }
        let huge = nativeSVGFixture(width: 1_000_000, height: 1000,
            contents: "<rect width=\"1000000\" height=\"1000\" fill=\"green\"/>")
        let request = try await XgentImageRequests.prepare(huge.base64EncodedString(), maximumPixelSize: 100_000)
        let image = try await XgentImageRequests.pipeline.image(for: request)
        let size = try nativeImageDimensions(XCTUnwrap(ImageEncoders.ImageIO(type: .png).encode(image)))
        XCTAssertEqual(size.0, 4096)
        XCTAssertEqual(size.1, 5)
    }

    @MainActor
    func testSVGNamespacesByteOrderMarksUTF16AndGradientsRender() async throws {
        let xml = """
        <?xml version="1.0"?>
        <s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 64 32">
          <s:defs><s:linearGradient id="g"><s:stop offset="0" stop-color="red"/>
            <s:stop offset="1" stop-color="blue"/></s:linearGradient></s:defs>
          <s:rect width="64" height="32" fill="url(#g)"/>
        </s:svg>
        """
        for data in [Data(("\u{FEFF}" + xml).utf8), try XCTUnwrap(xml.data(using: .utf16))] {
            let request = try await XgentImageRequests.prepare(data.base64EncodedString(), maximumPixelSize: 64)
            let image = try await XgentImageRequests.pipeline.image(for: request)
            let png = try XCTUnwrap(ImageEncoders.ImageIO(type: .png).encode(image))
            let pixel = try imagePixel(png, x: 32, y: 16)
            XCTAssertEqual(pixel[3], 255)
            XCTAssertGreaterThan(pixel[0], 0)
            XCTAssertGreaterThan(pixel[2], 0)
        }
    }

    @MainActor
    func testMalformedNonSVGAndInvalidCanvasInputsNeverReturnAnImage() async {
        for xml in ["<svg", "<note>Not an image</note>",
                    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"-1\" height=\"100\"/>",
                    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"NaN\" height=\"100\"/>",
                    "<svg xmlns=\"https://example.invalid\" width=\"100\" height=\"100\"/>"] {
            do {
                let request = try await XgentImageRequests.prepare(Data(xml.utf8).base64EncodedString(), maximumPixelSize: 100)
                _ = try await XgentImageRequests.pipeline.image(for: request)
                XCTFail("Invalid SVG input must fail through the actual decoder")
            } catch {}
        }
    }
}
