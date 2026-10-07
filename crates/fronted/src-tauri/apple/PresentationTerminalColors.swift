import SwiftUI
import SwiftTerm
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Handwritten terminal palette matching the shared XTermViewport light/dark styles.
struct XgentTerminalColors {
    let dark: Bool
    private var foreground: String { dark ? "#4ade80" : "#1f2933" }
    private var background: String { dark ? "#0b0f14" : "#fcfcfd" }
    private var cursor: String { dark ? "#f8fafc" : "#111827" }
    private var selection: String { dark ? "#2c3e57" : "#bfdbfe" }
    private var ansi: [UInt32] {
        dark
            ? [0x1b2733, 0xef4444, 0x22c55e, 0xeab308, 0x38bdf8, 0xc084fc, 0x2dd4bf, 0xcbd5e1,
               0x64748b, 0xf87171, 0x4ade80, 0xfde047, 0x7dd3fc, 0xd8b4fe, 0x5eead4, 0xf8fafc]
            : [0x1f2933, 0xdc2626, 0x16a34a, 0xb45309, 0x2563eb, 0x9333ea, 0x0891b2, 0xe2e8f0,
               0x64748b, 0xef4444, 0x22c55e, 0xd97706, 0x3b82f6, 0xa855f7, 0x06b6d4, 0xf8fafc]
    }

    @MainActor func apply(to view: TerminalView) {
        // SwiftTerm 1.20 defaults to LAB interpolation. Xterm uses the standard
        // cube and gray ramp for indices 16...255; its public strategy rebuilds it.
        view.getTerminal().ansi256PaletteStrategy = .xterm
        view.installColors(ansi.map {
            SwiftTerm.Color(red8: UInt16(($0 >> 16) & 255), green8: UInt16(($0 >> 8) & 255), blue8: UInt16($0 & 255))
        })
        #if os(iOS)
        view.nativeForegroundColor = UIColor(SwiftUI.Color(xgentHex: foreground))
        view.nativeBackgroundColor = UIColor(SwiftUI.Color(xgentHex: background))
        view.caretColor = UIColor(SwiftUI.Color(xgentHex: cursor))
        view.caretTextColor = UIColor(SwiftUI.Color(xgentHex: background))
        view.selectedTextBackgroundColor = UIColor(SwiftUI.Color(xgentHex: selection))
        #else
        view.nativeForegroundColor = NSColor(SwiftUI.Color(xgentHex: foreground))
        view.nativeBackgroundColor = NSColor(SwiftUI.Color(xgentHex: background))
        view.caretColor = NSColor(SwiftUI.Color(xgentHex: cursor))
        view.caretTextColor = NSColor(SwiftUI.Color(xgentHex: background))
        view.selectedTextBackgroundColor = NSColor(SwiftUI.Color(xgentHex: selection))
        #endif
    }
}
