import Foundation
#if os(iOS)
import UIKit
private typealias CodeNumberFont = UIFont
private typealias CodeNumberColor = UIColor
#else
import AppKit
private typealias CodeNumberFont = NSFont
private typealias CodeNumberColor = NSColor
#endif

struct XgentCodeLineIndex {
    private(set) var starts = [0]
    init(_ source: String) {
        let text = source as NSString
        var offset = 0
        while offset < text.length {
            var end = 0
            text.getLineStart(nil, end: &end, contentsEnd: nil, for: NSRange(location: offset, length: 0))
            guard end > offset else { break }
            if end < text.length || [10, 13].contains(Int(text.character(at: end - 1))) { starts.append(end) }
            offset = end
        }
    }
    func number(at offset: Int) -> Int {
        var low = 0, high = starts.count
        while low < high {
            let middle = (low + high) / 2
            if starts[middle] <= offset { low = middle + 1 } else { high = middle }
        }
        return max(1, low)
    }
}

@MainActor
enum XgentCodeLineNumbers {
    static func draw(in view: XgentCodeNativeTextView, visible: CGRect, inset: CGPoint) {
        guard let manager = view.textLayoutManager, let storage = manager.textContentManager else { return }
        let font = CodeNumberFont.monospacedDigitSystemFont(ofSize: max(9, (view.font?.pointSize ?? 13) - 2), weight: .regular)
        #if os(iOS)
        let color = CodeNumberColor.secondaryLabel
        #else
        let color = CodeNumberColor.secondaryLabelColor
        #endif
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        func number(_ value: Int, y: CGFloat) {
            let text = NSAttributedString(string: String(value), attributes: attributes)
            text.draw(at: CGPoint(x: visible.minX + max(4, inset.x - text.size().width - 8), y: y))
        }
        guard let first = manager.textLayoutFragment(for: CGPoint(x: 0, y: max(0, visible.minY - inset.y))) else {
            number(1, y: inset.y); return
        }
        manager.enumerateTextLayoutFragments(from: first.rangeInElement.location, options: [.ensuresLayout]) { fragment in
            let frame = fragment.layoutFragmentFrame
            guard frame.minY + inset.y <= visible.maxY else { return false }
            let offset = storage.offset(from: storage.documentRange.location, to: fragment.rangeInElement.location)
            number(view.lineIndex.number(at: offset), y: frame.minY + inset.y)
            if let trailing = fragment.textLineFragments.last, trailing.characterRange.length == 0 {
                number(view.lineIndex.starts.count, y: frame.minY + trailing.typographicBounds.minY + inset.y)
            }
            return true
        }
    }
}
