import Foundation

// Astryx removes one final LF from its visual lines, while copying the exact source.
struct XgentCodeBlockMetrics {
    let source: String

    var lineCount: Int {
        let newlines = source.unicodeScalars.reduce(0) { $0 + ($1.value == 10 ? 1 : 0) }
        return max(1, newlines + (source.unicodeScalars.last?.value == 10 ? 0 : 1))
    }

    var displayText: String {
        guard source.unicodeScalars.last?.value == 10 else { return source }
        // CRLF is a single Swift Character; remove only LF, as the shared renderer does.
        let text = source as NSString
        return text.substring(to: text.length - 1)
    }

    func canCollapse(_ configuration: XgentCodeBlockConfiguration, hasHeader: Bool) -> Bool {
        guard hasHeader, let threshold = configuration.collapseLines else { return false }
        return lineCount >= threshold
    }

    static func heightLimit(_ configuration: XgentCodeBlockConfiguration, viewportHeight: Double) -> Double? {
        let viewport = viewportHeight.isFinite && viewportHeight > 0 ? viewportHeight : 720
        let relative = configuration.viewportFraction.map { viewport * $0 }
        switch (configuration.maxHeight, relative) {
        case let (maximum?, relative?): return min(maximum, relative)
        case let (maximum?, nil): return maximum
        case let (nil, relative?): return relative
        case (nil, nil): return nil
        }
    }
}
