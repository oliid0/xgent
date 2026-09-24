import Foundation
import Photos
import Tauri
import UIKit

private struct PhotoListArgs: Decodable {
    let startMs: Int64?
    let endMs: Int64?
    let limit: Int
}
private struct PhotoReadArgs: Decodable { let id: String }

enum PhotoLibrary {
    private static func authorized(_ invoke: Invoke) -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            invoke.reject("Photo library permission is required")
            return false
        }
        return true
    }

    static func list(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PhotoListArgs.self)
        guard authorized(invoke) else { return }
        if let start = args.startMs, let end = args.endMs, end <= start {
            invoke.reject("Photo range end must be after start")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let limit = min(200, max(1, args.limit))
            let options = PHFetchOptions()
            options.fetchLimit = limit + 1
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            var predicates = [NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)]
            if let start = args.startMs {
                predicates.append(NSPredicate(format: "creationDate >= %@", NSDate(timeIntervalSince1970: Double(start) / 1000)))
            }
            if let end = args.endMs {
                predicates.append(NSPredicate(format: "creationDate < %@", NSDate(timeIntervalSince1970: Double(end) / 1000)))
            }
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
            let assets = PHAsset.fetchAssets(with: options)
            var photos: [[String: Any]] = []
            for index in 0..<min(limit, assets.count) {
                let asset = assets.object(at: index)
                photos.append([
                    "id": asset.localIdentifier,
                    "createdMs": asset.creationDate.map { Int64($0.timeIntervalSince1970 * 1000) as Any } ?? NSNull(),
                    "width": asset.pixelWidth, "height": asset.pixelHeight,
                ])
            }
            invoke.resolve([
                "photos": photos, "truncated": assets.count > limit,
                "accessLimited": PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited,
            ])
        }
    }

    static func read(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PhotoReadArgs.self)
        guard authorized(invoke) else { return }
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [args.id], options: nil).firstObject,
              asset.mediaType == .image else {
            invoke.reject("Photo is unavailable or not authorized")
            return
        }
        DispatchQueue.main.async {
            let manager = PHImageManager.default()
            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.resizeMode = .exact
            options.isNetworkAccessAllowed = false
            var finished = false
            var requestId: PHImageRequestID = 0
            let timeout = DispatchWorkItem {
                guard !finished else { return }
                finished = true
                manager.cancelImageRequest(requestId)
                invoke.reject("Photo read timed out")
            }
            requestId = manager.requestImage(for: asset, targetSize: CGSize(width: 2048, height: 2048), contentMode: .aspectFit, options: options) { image, info in
                DispatchQueue.main.async {
                    guard !finished else { return }
                    if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                    finished = true
                    timeout.cancel()
                    guard let image else {
                        invoke.reject((info?[PHImageErrorKey] as? Error)?.localizedDescription ?? "Photo is not stored locally; download it in Photos before reading")
                        return
                    }
                    let ratio = min(1, 2048 / max(image.size.width, image.size.height))
                    let size = CGSize(width: max(1, floor(image.size.width * ratio)), height: max(1, floor(image.size.height * ratio)))
                    let format = UIGraphicsImageRendererFormat()
                    format.scale = 1
                    let preview = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                        image.draw(in: CGRect(origin: .zero, size: size))
                    }
                    guard let data = preview.jpegData(compressionQuality: 0.85), data.count <= 10 * 1024 * 1024 else {
                        invoke.reject("Photo preview exceeds the 10 MB limit")
                        return
                    }
                    invoke.resolve(["id": args.id, "mimeType": "image/jpeg", "dataBase64": data.base64EncodedString(), "width": Int(size.width), "height": Int(size.height)])
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
        }
    }
}
