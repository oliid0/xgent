import SwiftUI

// The full-width WebSocket address precedes paired credentials, matching the
// desktop form. Passwords use the native secret field and shared saved hint.
struct XgentVoiceCredentials: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var address: XgentNode? {
        node.children?.first { $0.id.hasSuffix(":websocketUrl") }
    }
    private var credentials: [XgentNode] {
        (node.children ?? []).filter { !$0.id.hasSuffix(":websocketUrl") }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let address {
                XgentTextInput(node: address, document: document, model: model)
            }
            ForEach(Array(stride(from: 0, to: credentials.count, by: 2)), id: \.self) { index in
                XgentVoiceCredentialPair(
                    first: credentials[index],
                    second: index + 1 < credentials.count ? credentials[index + 1] : nil,
                    document: document, model: model)
            }
        }
        .environment(\.xgentSettingsRow, false)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
