#if os(macOS)
import AppKit
import SwiftUI

// The hidden transport webview does not own native application focus. Refresh
// the shared permission status when the actual application becomes active.
struct XgentComputerUsePermissionsCard: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        XgentDesktopSettingsCard(node: node, document: document, model: model)
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                if let refresh = document.node(id: "computer-use-refresh") {
                    model.send(refresh, in: document)
                }
            }
    }
}
#endif
