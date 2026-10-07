import Foundation
import SwiftTerm
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor
final class XgentTerminalCoordinator: NSObject, @preconcurrency TerminalViewDelegate {
    var emit: (String) -> Void
    private var sessionId: String?
    private var generation: Int?
    private var endOffset: Int?
    private var inputEnabled = false
    private var size: (cols: Int, rows: Int)?
    private var sentSize: (cols: Int, rows: Int)?
    private var retired = false
    private var darkPalette: Bool?

    init(emit: @escaping (String) -> Void) { self.emit = emit }

    func updateColors(_ colors: XgentTerminalColors, view: TerminalView) {
        guard !retired, darkPalette != colors.dark else { return }
        darkPalette = colors.dark
        colors.apply(to: view)
    }

    func update(value: String, view: TerminalView) {
        guard !retired else { return }
        guard let (packet, bytes) = XgentTerminalPacket.decode(value) else {
            inputEnabled = false
            if sessionId != nil {
                view.feed(text: "\u{1b}c")
                view.clearScrollback()
            }
            sessionId = nil
            generation = nil
            endOffset = nil
            sentSize = nil
            return
        }
        let replay = sessionId != packet.sessionId || generation != packet.generation ||
            endOffset == nil || packet.startOffset > (endOffset ?? 0) || packet.endOffset < (endOffset ?? 0)
        if replay {
            inputEnabled = false
            view.feed(text: "\u{1b}c")
            view.clearScrollback()
            sessionId = packet.sessionId
            generation = packet.generation
            endOffset = packet.startOffset
            sentSize = nil
        } else {
            inputEnabled = packet.enabled
        }
        let offset = max(0, (endOffset ?? packet.startOffset) - packet.startOffset)
        if offset < bytes.count { view.feed(byteArray: bytes[offset...]) }
        endOffset = packet.endOffset
        inputEnabled = packet.enabled
        if view.bounds.width > 0 && view.bounds.height > 0 {
            sizeChanged(source: view, newCols: view.getTerminal().cols, newRows: view.getTerminal().rows)
        }
    }

    func retire() {
        retired = true
        inputEnabled = false
        emit = { _ in }
    }

    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        guard !retired, inputEnabled, let sessionId else { return }
        // Match the shared terminal input buffer's 4 KiB batching and preserve
        // arbitrary bytes, including controls and multi-byte paste sequences.
        var offset = data.startIndex
        while offset < data.endIndex {
            let end = min(offset + 4096, data.endIndex)
            if let payload = XgentTerminalEvent.input(sessionId: sessionId, bytes: Data(data[offset..<end])).payload {
                emit(payload)
            }
            offset = end
        }
    }

    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        size = (min(400, max(2, newCols)), min(200, max(1, newRows)))
        reportSize()
    }

    private func reportSize() {
        guard !retired, let sessionId, let generation, let size,
              size.cols != sentSize?.cols || size.rows != sentSize?.rows else { return }
        sentSize = size
        // Geometry updates can originate inside updateNSView/updateUIView.
        // Send after layout, and retire queued callbacks on a session change.
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.retired, self.sessionId == sessionId, self.generation == generation,
                  self.size?.cols == size.cols, self.size?.rows == size.rows,
                  let payload = XgentTerminalEvent.resize(sessionId: sessionId, cols: size.cols, rows: size.rows).payload else { return }
            self.emit(payload)
        }
    }

    func setTerminalTitle(source: TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    func scrolled(source: TerminalView, position: Double) {}
    func bell(source: TerminalView) {}

    // SwiftTerm 1.20 requires this observer even when notifyUpdateChanges is off.
    // If a caller enables it, request painting of the updated terminal buffer.
    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {
        guard !retired, startY <= endY else { return }
        #if os(iOS)
        source.setNeedsDisplay()
        #else
        source.setNeedsDisplay(source.bounds)
        #endif
    }

    func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        guard let url = URL(string: link), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
        #if os(iOS)
        UIApplication.shared.open(url)
        #else
        NSWorkspace.shared.open(url)
        #endif
    }
}
