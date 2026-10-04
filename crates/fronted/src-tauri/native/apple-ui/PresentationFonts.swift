import Darwin
import Foundation
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum XgentFonts {
    // CSS fallback lists are shared settings data. Resolve each named family
    // against the actual Apple font inventory instead of treating the full
    // comma-separated list as a single PostScript font name.
    static func candidates(_ family: String?) -> [String] {
        (family ?? "").split(separator: ",").map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        }.filter { !$0.isEmpty }
    }

    @MainActor static func name(for family: String?) -> String? {
        for candidate in candidates(family) {
            #if os(iOS)
            if let font = UIFont(name: candidate, size: 15) { return font.fontName }
            if let name = UIFont.fontNames(forFamilyName: candidate).first(where: {
                $0.localizedCaseInsensitiveContains("regular")
            }) ?? UIFont.fontNames(forFamilyName: candidate).first { return name }
            #else
            if let font = NSFont(name: candidate, size: 15) { return font.fontName }
            if let font = NSFontManager.shared.font(withFamily: candidate, traits: [], weight: 5, size: 15) {
                return font.fontName
            }
            #endif
        }
        return nil
    }

    @MainActor static func body(_ family: String?, size: CGFloat, weight: Font.Weight = .regular) -> Font {
        // Callers supply sizes from ScaledMetric. A relative custom Font here
        // would apply Dynamic Type again and overflow settings at large sizes.
        if let name = name(for: family) { return .custom(name, fixedSize: size).weight(weight) }
        return .system(size: size, weight: weight)
    }

    @MainActor static func code(_ family: String?, size: CGFloat) -> Font {
        if let name = name(for: family) { return .custom(name, fixedSize: size) }
        return .system(size: size, design: .monospaced)
    }
}

// Ownership stays explicit at the FFI boundary: Rust copies this JSON while
// still on the UI thread and then calls the matching Swift deallocator.
@_cdecl("xgent_native_ui_font_families")
@MainActor public func xgentNativeUIFontFamilies() -> UnsafeMutablePointer<CChar>? {
    #if os(iOS)
    let families = UIFont.familyNames
    #else
    let families = NSFontManager.shared.availableFontFamilies
    #endif
    guard let data = try? JSONEncoder().encode(families.sorted()),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return json.withCString { strdup($0) }
}

@_cdecl("xgent_native_ui_font_families_free")
public func xgentNativeUIFontFamiliesFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}
