import SwiftUI

struct XgentContextUsagePopover: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    let close: () -> Void

    // A running task can change the token count or disable compaction while
    // the popover is open. Read the current business state at this surface.
    private var current: XgentNode {
        model.documents.first { $0.surface == document.surface }?.node(id: node.id) ?? node
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(current.label ?? "").font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text(current.text ?? current.accessibilityValue ?? "")
                    .font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                ProgressView(value: min(current.current ?? 0, current.total ?? 1),
                             total: max(current.total ?? 1, 1))
                    .tint(XgentContextUsageRing(node: current).color)
                    .accessibilityLabel(current.label ?? "")
                    .accessibilityValue(current.accessibilityValue ?? "")
                ForEach((current.children ?? []).filter { $0.kind == .text }) { description in
                    Text(description.text ?? "").font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let cancel = current.children?.first(where: { $0.id == "context-cancel" }) {
                    Button(action: close) {
                        Text(cancel.label ?? "")
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)
                            .contentShape(Rectangle())
                    }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier(cancel.id)
                }
                if let confirm = current.children?.first(where: { $0.id == "context-confirm" }) {
                    Button {
                        guard confirm.disabled != true, !model.isBusy(confirm, in: document) else { return }
                        model.send(confirm, in: document)
                        close()
                    } label: {
                        Text(confirm.label ?? "")
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(confirm.disabled == true || model.isBusy(confirm, in: document))
                    .accessibilityIdentifier(confirm.id)
                }
            }.padding(16)
        }
        .frame(width: 280)
        .frame(maxHeight: document.formFactor == .mobile ? 360 : 420)
        .accessibilityElement(children: .contain)
    }
}
