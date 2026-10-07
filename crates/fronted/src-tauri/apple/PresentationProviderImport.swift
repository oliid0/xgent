import Flow
import SwiftUI

// Import candidates are checkbox rows, not switches controlling provider
// enablement. Metadata wraps independently so long endpoints cannot cover actions.
struct XgentProviderImportRow: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let selection = node.children?.first {
                Button { model.send(selection, in: document) } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selection.selected == true ? "checkmark.square.fill" : "square")
                            .foregroundStyle(.tint).accessibilityHidden(true)
                        Text(selection.label ?? "").fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .modifier(XgentControlTypography(node: selection))
                .accessibilityIdentifier(selection.id)
                .accessibilityLabel(selection.label ?? "")
                .accessibilityAddTraits(selection.selected == true ? .isSelected : [])
                .disabled(selection.disabled == true || model.isBusy(selection, in: document))
            }
            if let url = node.children?.first(where: { $0.id.hasPrefix("provider-import-url:") }) {
                Text(url.text ?? "").font(.subheadline).foregroundStyle(.secondary)
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            HFlow(itemSpacing: 8, rowSpacing: 8) {
                ForEach((node.children ?? []).filter { $0.kind == .badge || $0.id.hasPrefix("provider-import-protocol:") }) { child in
                    XgentNodeView(node: child, document: document, model: model)
                }
            }
            ForEach((node.children ?? []).filter { $0.id.hasPrefix("provider-import-warning:") }) { child in
                XgentNodeView(node: child, document: document, model: model)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
