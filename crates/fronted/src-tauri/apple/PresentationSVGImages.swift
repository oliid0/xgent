import CoreGraphics
import Foundation
import ImageIO
import Nuke
import SwiftDraw
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// Parse once during off-main request preparation; draw on Nuke's decoding queue.
struct XgentSVGImageDecoder: ImageDecoding {
    static let requestKey = ImageRequest.UserInfoKey("xgent.svg-decoder")
    let svg: SVG
    let maximumPixelSize: Int

    init?(data: Data, maximumPixelSize: Int) {
        guard (1...4096).contains(maximumPixelSize), AssetType(data) == nil else { return nil }
        if let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetType(source) != nil {
            return nil
        }
        guard let svg = SVG(data: data),
              svg.size.width.isFinite, svg.size.height.isFinite,
              svg.size.width > 0, svg.size.height > 0 else { return nil }
        self.svg = svg
        self.maximumPixelSize = maximumPixelSize
    }

    func decode(_ data: Data) throws -> ImageContainer {
        let scale = CGFloat(maximumPixelSize) / max(svg.size.width, svg.size.height)
        guard scale.isFinite, scale > 0 else { throw ImageDecodingError.unknown }
        let width = Int(min(CGFloat(maximumPixelSize), max(1, (svg.size.width * scale).rounded(.up))))
        let height = Int(min(CGFloat(maximumPixelSize), max(1, (svg.size.height * scale).rounded(.up))))
        let size = CGSize(width: CGFloat(width), height: CGFloat(height))
        guard (size.width / svg.size.width).isFinite, (size.height / svg.size.height).isFinite,
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                  bytesPerRow: width * 4, space: colorSpace,
                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue).union(.byteOrder32Big)) else {
            throw ImageDecodingError.unknown
        }
        let bounds = CGRect(origin: .zero, size: size)
        context.clear(bounds)
        // SVG coordinates start at the top left; bitmap contexts start at the bottom left.
        context.translateBy(x: 0, y: size.height)
        context.scaleBy(x: 1, y: -1)
        context.draw(svg, in: bounds)
        guard let image = context.makeImage() else { throw ImageDecodingError.unknown }
        #if os(iOS)
        return ImageContainer(image: UIImage(cgImage: image, scale: 1, orientation: .up))
        #else
        return ImageContainer(image: NSImage(cgImage: image, size: size))
        #endif
    }
}
