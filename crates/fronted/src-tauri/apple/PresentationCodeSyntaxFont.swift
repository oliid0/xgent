import Foundation
#if os(iOS)
import UIKit
typealias XgentCodeSyntaxNativeFont = UIFont
#else
import AppKit
typealias XgentCodeSyntaxNativeFont = NSFont
#endif

@MainActor
enum XgentCodeSyntaxFont {
    static func styled(_ base: XgentCodeSyntaxNativeFont, flags: Int) -> XgentCodeSyntaxNativeFont {
        #if os(iOS)
        var traits = base.fontDescriptor.symbolicTraits
        traits.remove([.traitBold, .traitItalic])
        if flags & 1 != 0 { traits.insert(.traitItalic) }
        if flags & 2 != 0 { traits.insert(.traitBold) }
        return base.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: base.pointSize) } ?? base
        #else
        var traits = base.fontDescriptor.symbolicTraits
        traits.remove([.bold, .italic])
        if flags & 1 != 0 { traits.insert(.italic) }
        if flags & 2 != 0 { traits.insert(.bold) }
        return NSFont(descriptor: base.fontDescriptor.withSymbolicTraits(traits), size: base.pointSize) ?? base
        #endif
    }
}
