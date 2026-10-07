import SwiftUI

struct XgentBrowserTabs: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    @ViewBuilder private func content(_ item: XgentNode) -> some View {
        #if os(iOS)
        XgentIOSNode(node: item, document: document, model: model, parentAxis: .horizontal)
        #else
        XgentNodeView(node: item, document: document, model: model, parentAxis: .horizontal)
        #endif
    }

    private var tabs: [XgentNode] { node.children?.first { $0.variant == "browser-tab-items" }?.children ?? [] }
    private var selected: String? { tabs.first { $0.selected == true }?.id }

    var body: some View {
        Group {
            if !model.windowChromeInstalled {
                HStack(spacing: 6) {
                    if let add = node.children?.first { content(add) }
                    ScrollViewReader { proxy in
                        ScrollView(.horizontal) {
                            HStack(spacing: 4) {
                                ForEach(tabs) { tab in
                                    XgentBrowserTabButton(node: tab, document: document, model: model).id(tab.id)
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                        .fixedSize(horizontal: false, vertical: true)
                        .focusable()
                        .onAppear { if let selected { proxy.scrollTo(selected) } }
                        .onChange(of: selected) { _, id in if let id { proxy.scrollTo(id) } }
                        .onKeyPress(.leftArrow) { select(-1) }
                        .onKeyPress(.rightArrow) { select(1) }
                    }
                    ForEach((node.children ?? []).dropFirst().filter { $0.variant != "browser-tab-items" }) { content($0) }
                }
                .padding(.horizontal, 8).padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .contain)
            }
        }
    }

    private func select(_ direction: Int) -> KeyPress.Result {
        guard let index = tabs.firstIndex(where: { $0.selected == true }), !tabs.isEmpty else { return .ignored }
        let next = tabs[(index + direction + tabs.count) % tabs.count]
        guard next.disabled != true else { return .ignored }
        model.send(next, in: document)
        return .handled
    }
}
