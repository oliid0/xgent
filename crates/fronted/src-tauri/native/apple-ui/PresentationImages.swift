import CryptoKit
import Foundation
import Nuke
import NukeUI
import SwiftUI

enum XgentImageRequests {
    static let maximumBytes = 25 * 1024 * 1024
    static let pipeline: ImagePipeline = {
        let cache = ImageCache(costLimit: 64 * 1024 * 1024, countLimit: 64)
        cache.entryCostLimit = 1
        return ImagePipeline {
            $0.imageCache = cache
            $0.dataCache = nil
        }
    }()

    // Base64 decoding and content hashing happen away from SwiftUI's render path.
    nonisolated static func prepare(_ encoded: String, maximumPixelSize: Float) async throws -> ImageRequest {
        let task = Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            guard maximumPixelSize.isFinite, maximumPixelSize > 0 else { throw ImageError.invalid }
            let pixels = Int(min(4096, maximumPixelSize.rounded(.up)))
            var payload = encoded[...]
            if encoded.hasPrefix("data:") {
                guard let comma = encoded.firstIndex(of: ","),
                      encoded[..<comma].lowercased().contains(";base64") else { throw ImageError.invalid }
                payload = encoded[encoded.index(after: comma)...]
            }
            guard payload.utf8.count <= ((maximumBytes + 2) / 3) * 4,
                  let bytes = Data(base64Encoded: String(payload)),
                  !bytes.isEmpty, bytes.count <= maximumBytes else { throw ImageError.invalid }
            try Task.checkCancellation()
            let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            try Task.checkCancellation()
            // Pixel size is part of the identity so LazyImage also refreshes after resizing.
            var request = ImageRequest(id: "xgent-image:\(digest):\(pixels)", data: { bytes }, options: [.disableDiskCache])
            request.thumbnail = .init(maxPixelSize: Float(pixels))
            return request
        }
        return try await withTaskCancellationHandler(operation: {
            let request = try await task.value
            try Task.checkCancellation()
            return request
        }, onCancel: {
            task.cancel()
        })
    }

    private enum ImageError: Error { case invalid }
}

@MainActor
struct XgentDataImage<Placeholder: View>: View {
    let encoded: String
    let maximumPixelSize: Float
    let contentMode: ContentMode
    let label: String
    var retryable = false
    let placeholder: () -> Placeholder
    @State private var prepared: Prepared?
    @State private var retry = 0

    init(encoded: String, maximumPixelSize: Float, contentMode: ContentMode, label: String,
         retryable: Bool = false, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.encoded = encoded
        self.maximumPixelSize = maximumPixelSize
        self.contentMode = contentMode
        self.label = label
        self.retryable = retryable
        self.placeholder = placeholder
    }

    private struct Source: Equatable {
        let encoded: String
        let pixels: Float
        let retry: Int
    }
    private struct Prepared {
        let source: Source
        let request: ImageRequest?
    }

    private var source: Source { Source(encoded: encoded, pixels: maximumPixelSize, retry: retry) }

    var body: some View {
        Group {
            if encoded.isEmpty {
                placeholder()
            } else if let prepared, prepared.source.encoded == encoded, prepared.source.retry == retry {
                if let request = prepared.request {
                    LazyImage(request: request) { state in
                        if let image = state.image {
                            image.resizable().aspectRatio(contentMode: contentMode)
                                .accessibilityLabel(label)
                        } else if state.error != nil {
                            failed
                        } else {
                            loading
                        }
                    }
                    .pipeline(XgentImageRequests.pipeline)
                    .id(request.imageID)
                } else {
                    failed
                }
            } else {
                loading
            }
        }
        .task(id: source) {
            let current = source
            guard !current.encoded.isEmpty else { prepared = nil; return }
            do {
                let request = try await XgentImageRequests.prepare(current.encoded, maximumPixelSize: current.pixels)
                try Task.checkCancellation()
                prepared = Prepared(source: current, request: request)
            } catch {
                guard !Task.isCancelled else { return }
                prepared = Prepared(source: current, request: nil)
            }
        }
    }

    private var loading: some View {
        placeholder().overlay {
            ProgressView().controlSize(.small)
                .accessibilityLabel("Loading \(label)")
        }
    }

    @ViewBuilder private var failed: some View {
        if retryable {
            VStack(spacing: 10) {
                Label("Unable to load image", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
                Button("Retry") { retry &+= 1 }
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("Unable to load \(label)")
        } else {
            placeholder()
        }
    }
}

@MainActor
struct XgentImagePreview: View {
    let encoded: String
    let label: String
    @Environment(\.displayScale) private var displayScale
    @State private var zoom: CGFloat = 1
    @GestureState private var magnification: CGFloat = 1

    private func clamped(_ value: CGFloat) -> CGFloat { min(8, max(1, value)) }

    var body: some View {
        GeometryReader { proxy in
            let scale = clamped(zoom * magnification)
            let width = max(1, proxy.size.width)
            let height = max(1, proxy.size.height - 50)
            // Quantized display pixels avoid repeated decoding during small layout changes.
            let pixels = Float(min(4096, max(256, ceil(max(width, height) * displayScale * zoom / 256) * 256)))
            VStack(spacing: 0) {
                ScrollView([.horizontal, .vertical]) {
                    XgentDataImage(encoded: encoded, maximumPixelSize: pixels, contentMode: .fit,
                                   label: label, retryable: true) {
                        Color.secondary.opacity(0.06)
                    }
                    .frame(width: width * scale, height: height * scale)
                }
                .simultaneousGesture(MagnifyGesture()
                    .updating($magnification) { value, state, _ in state = value.magnification }
                    .onEnded { zoom = clamped(zoom * $0.magnification) })
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: zoom = clamped(zoom * 1.5)
                    case .decrement: zoom = clamped(zoom / 1.5)
                    @unknown default: break
                    }
                }
                HStack(spacing: 12) {
                    zoomButton("Zoom out", icon: "minus.magnifyingglass", disabled: zoom <= 1) { zoom = clamped(zoom / 1.5) }
                    Button("\(Int(zoom * 100))%") { zoom = 1 }
                        .font(.caption.monospacedDigit())
                        .lineLimit(1).minimumScaleFactor(0.5)
                        .frame(minWidth: 64, minHeight: 44)
                        .accessibilityLabel("Fit image")
                        .accessibilityValue("\(Int(zoom * 100)) percent")
                    zoomButton("Zoom in", icon: "plus.magnifyingglass", disabled: zoom >= 8) { zoom = clamped(zoom * 1.5) }
                }
                .frame(maxWidth: .infinity, minHeight: 50)
            }
        }
        .onChange(of: encoded) { _, _ in zoom = 1 }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func zoomButton(_ label: String, icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).frame(minWidth: 44, minHeight: 44) }
            .accessibilityLabel(label)
            .disabled(disabled)
    }
}
