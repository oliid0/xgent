import SwiftUI

struct XgentSkillPreview: View {
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

    private var items: [XgentNode] { node.children ?? [] }
    private var close: XgentNode? { items.first { $0.kind == .iconButton } }
    private var title: XgentNode? { items.first { $0.kind == .heading } }
    private var controls: [XgentNode] { items.filter { $0.variant == "extension-preview-controls" } }
    private var footer: XgentNode? { items.first { $0.variant == "extension-preview-footer" } }
    private var bodyItems: [XgentNode] {
        if let body = items.first(where: { $0.variant == "extension-preview-body" }) { return body.children ?? [] }
        return items.filter { $0.id != close?.id && $0.id != title?.id && $0.id != footer?.id &&
            $0.variant != "extension-preview-controls" }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                if let title { content(title).frame(maxWidth: .infinity, alignment: .leading) }
                else { Text(node.label ?? document.title).font(.title3.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(controls) { group in
                    ForEach(group.children ?? []) { control in
                        if control.kind == .toggle {
                            let value = Binding(get: { model.value(control, in: document).boolean },
                                set: { model.send(control, in: document, value: .bool($0), editing: true) })
                            #if os(iOS)
                            XgentIOSNativeSwitch(value: value, node: control)
                                .fixedSize(horizontal: true, vertical: false)
                            #else
                            Toggle(control.label ?? "", isOn: value).toggleStyle(.switch).labelsHidden()
                                .disabled(control.disabled == true).frame(minHeight: 32)
                                .accessibilityLabel(control.label ?? "").accessibilityIdentifier(control.id)
                            #endif
                        } else { content(control) }
                    }
                }
                if let close { content(close) }
            }
            .padding(16)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(bodyItems) { content($0) }
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            if let footer {
                Divider()
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        ForEach(footer.children ?? []) { content($0) }
                    }.fixedSize(horizontal: true, vertical: false)
                    VStack(alignment: .trailing, spacing: 8) {
                        ForEach(footer.children ?? []) { content($0) }
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(12).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .background { XgentThemeBackground() }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .contain).accessibilityIdentifier(node.id)
    }
}
