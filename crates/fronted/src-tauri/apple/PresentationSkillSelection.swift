import SwiftUI

struct XgentSkillSelection: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    var checkbox = false
    var showsLabel = false

    private var value: Binding<Bool> {
        Binding(get: { model.value(node, in: document).boolean },
                set: { model.send(node, in: document, value: .bool($0), editing: true) })
    }

    var body: some View {
        Group {
            if checkbox {
                #if os(macOS)
                Toggle(node.label ?? "", isOn: value).toggleStyle(.checkbox).labelsHidden()
                #else
                Button { value.wrappedValue.toggle() } label: {
                    Image(systemName: value.wrappedValue ? "checkmark.square.fill" : "square")
                        .font(.title3).frame(minWidth: 44, minHeight: 44)
                }.buttonStyle(.plain)
                    .accessibilityAddTraits(value.wrappedValue ? .isSelected : [])
                #endif
            } else {
                if showsLabel { Toggle(node.label ?? "", isOn: value).toggleStyle(.switch) }
                else { Toggle(node.label ?? "", isOn: value).toggleStyle(.switch).labelsHidden() }
            }
        }
        .frame(minHeight: document.formFactor == .mobile ? 44 : 28)
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityLabel(node.label ?? "")
        .accessibilityIdentifier(node.id)
    }
}
