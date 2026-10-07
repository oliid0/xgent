import CodeEditorView
import SwiftUI

@MainActor
struct XgentReusableCodeInput {
    let input: XgentCodeNativeInput
    @Binding var text: String
    @Binding var position: CodeEditor.Position
    let wrap: Bool
    let fontName: String?
    let fontSize: CGFloat
    let palette: XgentPalette
    let label: String
    private func update() {
        input.update(text: $text, position: $position, wrap: wrap, fontName: fontName,
                     fontSize: fontSize, palette: palette, label: label)
    }
}

#if os(iOS)
import UIKit
extension XgentReusableCodeInput: UIViewRepresentable {
    func makeUIView(context: Context) -> UITextView { update(); return input.view }
    func updateUIView(_ view: UITextView, context: Context) { update() }
}
#else
import AppKit
extension XgentReusableCodeInput: NSViewRepresentable {
    func makeNSView(context: Context) -> NSScrollView { update(); return input.scroll }
    func updateNSView(_ scroll: NSScrollView, context: Context) { update() }
}
#endif
