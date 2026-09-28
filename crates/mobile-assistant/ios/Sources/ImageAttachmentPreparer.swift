import Foundation
import ImageIO
import Tauri
import UniformTypeIdentifiers

private struct ImageAttachmentArgs: Decodable {
    let fileName: String
    let contentBase64: String
}

enum ImageAttachmentPreparer {
    private static let maxInputBytes = 20 * 1024 * 1024
    private static let maxOutputBytes = 5 * 1024 * 1024
    private static let extensions = [
        "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
        "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp",
        "image/x-icon": "ico",
    ]

    static func run(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ImageAttachmentArgs.self)
        DispatchQueue.global(qos: .userInitiated).async {
            do { invoke.resolve(try prepare(fileName: args.fileName, contentBase64: args.contentBase64)) }
            catch { invoke.reject("Image preparation failed: \(error.localizedDescription)") }
        }
    }

    static func prepare(fileName: String, contentBase64: String) throws -> [String: String] {
        guard !contentBase64.isEmpty, contentBase64.utf8.count <= ((maxInputBytes + 2) / 3) * 4,
              let bytes = Data(base64Encoded: contentBase64), !bytes.isEmpty, bytes.count <= maxInputBytes,
              let source = CGImageSourceCreateWithData(bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) > 0,
              let identifier = CGImageSourceGetType(source),
              let type = UTType(identifier as String) else {
            throw failure("Invalid photo or photo exceeds the 20 MB import limit")
        }
        if let mimeType = type.preferredMIMEType, extensions[mimeType] != nil, bytes.count <= maxOutputBytes {
            return result(fileName: fileName, mimeType: mimeType, bytes: bytes)
        }
        var edge = 2048
        while edge >= 1 {
            // Apply orientation during a bounded decode rather than allocating the full photo.
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: edge,
                kCGImageSourceShouldCacheImmediately: true,
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                throw failure("Unsupported photo format")
            }
            let alpha = ![CGImageAlphaInfo.none, .noneSkipFirst, .noneSkipLast].contains(image.alphaInfo)
            let outputType = alpha ? UTType.png : UTType.jpeg
            let output = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, outputType.identifier as CFString, 1, nil) else {
                throw failure("Unable to encode photo")
            }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { throw failure("Unable to encode photo") }
            if output.length <= maxOutputBytes {
                return result(fileName: fileName, mimeType: alpha ? "image/png" : "image/jpeg", bytes: output as Data)
            }
            edge /= 2
        }
        throw failure("Photo exceeds the 5 MB preview limit")
    }

    private static func result(fileName: String, mimeType: String, bytes: Data) -> [String: String] {
        let basename = fileName.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? "photo"
        let stem = (basename as NSString).deletingPathExtension
        return [
            "fileName": "\(stem.isEmpty ? "photo" : stem).\(extensions[mimeType]!)",
            "mimeType": mimeType,
            "contentBase64": bytes.base64EncodedString(),
        ]
    }

    private static func failure(_ message: String) -> NSError {
        NSError(domain: "XgentImageAttachment", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
