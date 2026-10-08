import CoreGraphics
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class ProviderBrandRenderingTests: XCTestCase {
    @MainActor func testBrandColorsSurviveForegroundStylesAtActualControlSizes() throws {
        for name in ["xgent.provider.claude_code", "xgent.provider.gemini"] {
            for size in [CGFloat(17), 32] {
                for scheme in [ColorScheme.light, .dark] {
                    let renderer = ImageRenderer(content: XgentControlIcon(name: name, size: size)
                        .foregroundStyle(scheme == .dark ? Color.white : .black)
                        .environment(\.colorScheme, scheme))
                    renderer.scale = 2
                    let image = try XCTUnwrap(renderer.cgImage)
                    XCTAssertEqual(image.width, Int(size * 2))
                    XCTAssertEqual(image.height, Int(size * 2))
                    let context = try XCTUnwrap(CGContext(data: nil, width: image.width, height: image.height,
                        bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
                    context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(image.width), height: CGFloat(image.height)))
                    let pixels = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
                    var colored = 0
                    for offset in stride(from: 0, to: image.width * image.height * 4, by: 4) {
                        let channels = [Int(pixels[offset]), Int(pixels[offset + 1]), Int(pixels[offset + 2])]
                        if pixels[offset + 3] > 128, channels.max()! - channels.min()! > 40 { colored += 1 }
                    }
                    XCTAssertGreaterThan(colored, 10, "Brand colors must survive selected and secondary text styles")
                    #if os(iOS)
                    let attachment = XCTAttachment(image: try XCTUnwrap(renderer.uiImage))
                    #else
                    let attachment = XCTAttachment(image: try XCTUnwrap(renderer.nsImage))
                    #endif
                    attachment.name = "provider-brand-\(name)-\(Int(size))-\(scheme)"
                    attachment.lifetime = .keepAlways; add(attachment)
                }
            }
        }
    }
}
