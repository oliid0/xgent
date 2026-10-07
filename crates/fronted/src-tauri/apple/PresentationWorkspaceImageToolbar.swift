import Flow
import SwiftUI

struct XgentWorkspaceImageToolbar: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Binding var zoom: CGFloat
    @Environment(\.dynamicTypeSize) private var typeSize
    private var controlHeight: CGFloat {
        #if os(iOS)
        return 44
        #else
        return typeSize.isAccessibilitySize ? 44 : 32
        #endif
    }

    private func item(_ suffix: String) -> XgentNode? { node.children?.first { $0.id == "workspace-file-image-\(suffix)" } }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { navigation; Spacer(minLength: 8); controls }
            VStack(alignment: .leading, spacing: 0) {
                navigation
                HFlow(itemSpacing: 4, rowSpacing: 4) { controls }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    private var navigation: some View {
        HStack(spacing: 4) {
            navigationButton("previous")
            navigationButton("next")
            Text(node.text ?? "").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true).lineLimit(2)
        }
    }

    @ViewBuilder private func navigationButton(_ suffix: String) -> some View {
        if let item = item(suffix) {
            XgentImageToolButton(label: item.label ?? "", icon: item.icon ?? "chevron.right", id: item.id,
                                 disabled: item.disabled == true, busy: model.isBusy(item, in: document)) {
                model.send(item, in: document)
            }
        }
    }

    @ViewBuilder private var controls: some View {
        zoomButton("zoom-out", disabled: zoom <= 0.25) { zoom = XgentWorkspaceImageCanvas.clamped(zoom - 0.25) }
        if let fit = item("fit") {
            Button { zoom = 1 } label: { Text("\(Int((zoom * 100).rounded()))%").font(.caption.monospacedDigit()).frame(minWidth: 52, minHeight: controlHeight) }
                .buttonStyle(.plain).accessibilityIdentifier(fit.id).accessibilityLabel(fit.label ?? "")
                .accessibilityValue("\(Int((zoom * 100).rounded()))%")
        }
        zoomButton("zoom-in", disabled: zoom >= 4) { zoom = XgentWorkspaceImageCanvas.clamped(zoom + 0.25) }
        if let rotate = item("rotation") { XgentImageRotationButton(node: rotate, document: document, model: model) }
        if let save = item("save") {
            XgentImageToolButton(label: save.label ?? "", icon: save.icon ?? "square.and.arrow.down", id: save.id,
                                 disabled: save.disabled == true || (XgentImageRotationDraft.relative(in: document, model: model) ?? 0) == 0,
                                 busy: model.isBusy(save, in: document)) {
                guard let angle = XgentImageRotationDraft.angle(in: document, model: model) else { return }
                model.send(save, in: document, value: .number(angle))
            }
        }
    }

    @ViewBuilder private func zoomButton(_ suffix: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        if let item = item(suffix) {
            XgentImageToolButton(label: item.label ?? "", icon: item.icon ?? "plus", id: item.id, disabled: disabled, action: action)
        }
    }
}
