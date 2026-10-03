import SwiftUI

struct XgentCodeFindAction: Encodable {
    let kind = "workspaceFind"
    let command: String
    let content: String
    let query: String
    let replacement: String
    let options: XgentCodeFindOptions
    let selections: [XgentCodeFindRange]
    var editRequest: Int? = nil
    var applied: Bool? = nil

    var encoded: String? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

extension XgentTextArea {
    func sendFind(_ action: XgentCodeFindAction) {
        guard let control = document.node(id: "workspace-file-find-action"), let value = action.encoded else { return }
        // Query changes must remain responsive while earlier input is being
        // acknowledged. The business handler validates the complete envelope.
        model.send(control, in: document, value: .string(value), editing: true)
    }
}
