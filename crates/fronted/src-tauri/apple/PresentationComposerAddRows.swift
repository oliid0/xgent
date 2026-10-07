import SwiftUI

// Only action rows dismiss the panel; runtime switches and selectors stay open.
struct XgentComposerAddRows: View {
    let nodes: [XgentNode]
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    let dismiss: () -> Void

    var body: some View {
        ForEach(nodes) { child in
            if child.kind == .section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(child.label ?? "").font(.subheadline).foregroundStyle(.secondary)
                        .accessibilityAddTraits(.isHeader)
                    AnyView(XgentComposerAddRows(nodes: child.children ?? [], document: document, model: model, dismiss: dismiss))
                }
            } else if child.kind == .button {
                Button {
                    model.send(child, in: document)
                    dismiss()
                } label: {
                    HStack(alignment: .center, spacing: 12) {
                        Image(systemName: child.icon ?? "plus").frame(width: 24).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(child.label ?? "").fixedSize(horizontal: false, vertical: true)
                            if let text = child.text, !text.isEmpty {
                                Text(text).font(.subheadline).foregroundStyle(.secondary)
                                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 0)
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(child.disabled == true || model.isBusy(child, in: document))
                .accessibilityIdentifier(child.id)
            } else {
                XgentNodeView(node: child, document: document, model: model)
            }
        }
    }
}
