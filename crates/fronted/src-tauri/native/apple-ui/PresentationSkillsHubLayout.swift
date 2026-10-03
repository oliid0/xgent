import SwiftUI

struct XgentSkillsHubLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model)
        #else
        XgentNodeView(node: item, document: document, model: model)
        #endif
    }

    var body: some View {
        GeometryReader { geometry in
            let main = node.children?.first { $0.variant == "skills-hub-main" }
            let preview = node.children?.first { $0.variant == "skill-preview" }
            if let main {
                if let preview {
                    if document.formFactor == .desktop && geometry.size.width >= 960 && !textSize.isAccessibilitySize {
                        HStack(alignment: .top, spacing: 0) {
                            content(main).frame(maxWidth: .infinity, maxHeight: .infinity)
                            Divider()
                            content(preview).frame(width: min(420, geometry.size.width * 0.4))
                        }
                    } else { content(preview) }
                } else { content(main) }
            }
        }
        .frame(minHeight: document.mode == .sheet ? 600 : nil)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .environment(\.xgentSettingsRow, false)
    }
}
