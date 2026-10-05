#if os(iOS)
import SwiftUI

struct XgentSidebarSoulPicker: View {
    let menu: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    let close: () -> Void

    private var current: XgentNode {
        model.documents.first { $0.surface == document.surface }?.node(id: menu.id) ?? menu
    }
    private var presets: [XgentNode] {
        current.children?.first { $0.id == "sidebar-soul-presets" }?.children ?? []
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(current.label ?? "").font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                VStack(spacing: 0) {
                    ForEach(presets) { preset in
                        row(preset)
                        if preset.id != presets.last?.id { Divider().padding(.leading, 44) }
                    }
                }
                .background(Color(uiColor: .secondarySystemGroupedBackground).opacity(0.82),
                            in: RoundedRectangle(cornerRadius: 22))
                if let create = current.children?.first(where: { $0.id == "sidebar-soul-create" }) { row(create) }
            }.padding(20)
        }
        .accessibilityIdentifier("sidebar-soul-picker")
    }

    private func row(_ item: XgentNode) -> some View {
        Button {
            guard item.disabled != true, !model.isBusy(item, in: document) else { return }
            model.send(item, in: document)
            close()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: item.icon ?? "sparkles").frame(width: 24)
                Text(item.label ?? "").font(.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if item.selected == true { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
            .padding(12).frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.disabled == true || model.isBusy(item, in: document))
        .accessibilityLabel(item.label ?? "")
        .accessibilityIdentifier(item.id)
        .accessibilityAddTraits(item.selected == true ? .isSelected : [])
    }
}
#endif
