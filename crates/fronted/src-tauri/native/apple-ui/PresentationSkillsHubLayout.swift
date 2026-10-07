import SwiftUI

struct XgentSkillsHubLayout: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

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
                content(main)
                    .sheet(isPresented: Binding(get: { preview != nil }, set: { open in
                        guard !open, let close = preview?.children?.first(where: { $0.id.hasSuffix("-close") }) else { return }
                        model.send(close, in: document)
                    })) {
                        if let preview {
                            #if os(macOS)
                            let size = XgentDesktopSheetSizing.settingsSize(in: geometry.size)
                            content(preview).frame(width: size.width, height: size.height)
                            #else
                            content(preview).presentationDetents([.large])
                            #endif
                        }
                    }
            }
        }
        .frame(minHeight: document.mode == .sheet ? 600 : nil)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .environment(\.xgentSettingsRow, false)
    }
}
