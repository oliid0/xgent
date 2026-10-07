import SwiftUI
#if os(iOS)
import UIKit
private typealias SyntaxColor = UIColor
#else
import AppKit
private typealias SyntaxColor = NSColor
#endif

@MainActor
final class XgentCodeSyntaxPainter {
    private var configuration: XgentCodeSyntaxConfiguration?
    private var index: XgentCodeSyntaxIndex?
    private var source = XgentCodeSyntaxSource(nil)
    private var dark = false
    private(set) var used = false
    @discardableResult
    func update(_ value: XgentCodeSyntaxConfiguration?, colorScheme: ColorScheme) -> Bool {
        let changed = configuration != value || dark != (colorScheme == .dark)
        if configuration != value {
            configuration = value; index = value.flatMap(XgentCodeSyntaxIndex.init)
            source = XgentCodeSyntaxSource(value?.source)
        }
        dark = colorScheme == .dark; used = used || value != nil
        return changed
    }
    func eligible(source actual: String?) -> Bool { source.synchronize(actual) }
    func clear(_ range: NSTextRange, on manager: NSTextLayoutManager) {
        guard used else { return }
        for key in [NSAttributedString.Key.foregroundColor, .font, .underlineStyle, .strikethroughStyle] {
            manager.removeRenderingAttribute(key, for: range)
        }
    }
    func paint(_ fragment: NSTextLayoutFragment, on manager: NSTextLayoutManager, font: XgentCodeSyntaxNativeFont?) {
        guard let configuration, let index, let font,
              let storage = manager.textContentManager as? NSTextContentStorage,
              let fragmentRange = XgentCodeTextKitRange.utf16(fragment.rangeInElement, in: storage),
              let range = source.clip(fragmentRange) else { return }
        // Font and theme changes retain the user's family and Dynamic Type size.
        var fonts: [Int: XgentCodeSyntaxNativeFont] = [:]
        for run in index.intersections(range) {
            guard let native = XgentCodeTextKitRange.native(run.range, in: storage) else { continue }
            let style = dark ? configuration.styles[run.style].dark : configuration.styles[run.style].light
            let styled = fonts[style.fontStyle] ?? XgentCodeSyntaxFont.styled(font, flags: style.fontStyle)
            fonts[style.fontStyle] = styled
            manager.addRenderingAttribute(.foregroundColor, value: SyntaxColor(Color(xgentHex: style.color)), for: native)
            manager.addRenderingAttribute(.font, value: styled, for: native)
            manager.addRenderingAttribute(.underlineStyle, value: style.fontStyle & 4 != 0 ? NSUnderlineStyle.single.rawValue : 0, for: native)
            manager.addRenderingAttribute(.strikethroughStyle, value: style.fontStyle & 8 != 0 ? NSUnderlineStyle.single.rawValue : 0, for: native)
        }
    }
}
