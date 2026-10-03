import SwiftUI

struct XgentWorkspaceEditorTabs: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @State private var contentHeight: CGFloat = 56
    private var tabs: [XgentNode] { node.children ?? [] }
    private var selected: String? { tabs.first { $0.selected == true }?.id }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(tabs) { tab in
                        XgentWorkspaceEditorTab(node: tab, document: document, model: model).id(tab.id)
                    }
                }.padding(.horizontal, 8).padding(.vertical, 6)
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                        if height.isFinite, height > 0, abs(contentHeight - height) > 0.5 { contentHeight = height }
                    }
            }
            .scrollIndicators(.hidden)
            .focusable()
            .onAppear { if let selected { proxy.scrollTo(selected) } }
            .onChange(of: selected) { _, id in if let id { proxy.scrollTo(id) } }
            .onKeyPress(.leftArrow) { select(-1) }
            .onKeyPress(.rightArrow) { select(1) }
        }
        .frame(minWidth: 0, maxWidth: .infinity)
        .frame(height: contentHeight)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(node.label ?? "")
    }

    private func select(_ direction: Int) -> KeyPress.Result {
        guard let index = tabs.firstIndex(where: { $0.selected == true }), !tabs.isEmpty,
              let action = tabs[(index + direction + tabs.count) % tabs.count].children?.first,
              action.disabled != true, !model.isBusy(action, in: document) else { return .ignored }
        XgentWorkspaceTabAction.send(action, document: document, model: model)
        return .handled
    }
}
