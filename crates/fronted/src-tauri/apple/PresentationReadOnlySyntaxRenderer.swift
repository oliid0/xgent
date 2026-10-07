import SwiftUI
#if os(iOS)
import UIKit
private typealias XgentReadOnlyColor = UIColor
#else
import AppKit
private typealias XgentReadOnlyColor = NSColor
#endif

struct XgentReadOnlySyntaxRenderer {
    let syntax: XgentReadOnlySyntax
    let scheme: ColorScheme

    func attributedCode(_ display: String) -> NSAttributedString {
        let value = NSMutableAttributedString(string: display)
        guard syntax.source.utf16.starts(with: display.utf16),
              syntax.styles.indices.contains(syntax.baseStyle), syntax.styles.allSatisfy(\.valid),
              let index = XgentCodeSyntaxIndex(source: syntax.source, styleCount: syntax.styles.count, runs: syntax.runs) else { return value }
        let range = NSRange(location: 0, length: value.length)
        func color(_ style: Int) -> XgentReadOnlyColor {
            let entry = syntax.styles[style]
            return XgentReadOnlyColor(Color(xgentHex: scheme == .dark ? entry.dark : entry.light))
        }
        value.addAttribute(.foregroundColor, value: color(syntax.baseStyle), range: range)
        for run in index.intersections(range) {
            value.addAttribute(.foregroundColor, value: color(run.style), range: run.range)
        }
        // Font is supplied by SwiftUI so family and Dynamic Type are preserved.
        return value
    }

    func text(_ display: String) -> Text {
        let value = attributedCode(display)
        #if os(iOS)
        let attributed = try? AttributedString(value, including: \.uiKit)
        #else
        let attributed = try? AttributedString(value, including: \.appKit)
        #endif
        return Text(attributed ?? AttributedString(display))
    }
}
