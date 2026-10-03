import Foundation

struct XgentWorkspaceSourceDraft {
    let content: String
    let dirty: Bool

    var encoded: String? {
        guard let data = try? JSONSerialization.data(withJSONObject: ["kind": "source", "content": content]) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @MainActor static func current(for action: XgentNode, in document: XgentDocument,
                                   model: XgentPresentationModel) -> Self? {
        guard let current = model.documents.first(where: { $0.surface == document.surface }),
              let editor = current.node(id: "workspace-file-editor"), editor.kind == .textArea,
              editor.disabled != true else { return nil }
        let content = model.value(editor, in: document).text
        return Self(content: content, dirty: action.current == 1 || content != editor.value?.text)
    }
}
