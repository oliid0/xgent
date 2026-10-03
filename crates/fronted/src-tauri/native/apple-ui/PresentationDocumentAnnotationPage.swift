import SwiftUI

struct XgentDocumentAnnotationPage: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private var page: Binding<Int> {
        Binding(get: {
            guard case .number(let number) = model.value(node, in: document), number.isFinite else { return 1 }
            return Int(min(Double(XgentDocumentAnnotationDraft.maximumPage), max(1, number)))
        }, set: { number in
            let bounded = min(XgentDocumentAnnotationDraft.maximumPage, max(1, number))
            model.send(node, in: document, value: .number(Double(bounded)), editing: true)
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            XgentFieldLabel(node: node)
            HStack(spacing: 12) {
                field.textFieldStyle(.plain).modifier(XgentFieldSurface(node: node))
                    .modifier(XgentControlTypography(node: node))
                    .frame(minWidth: 60, maxWidth: .infinity)
                    .accessibilityIdentifier(node.id).accessibilityLabel(node.label ?? "")
                Stepper(node.label ?? "", value: page, in: 1...XgentDocumentAnnotationDraft.maximumPage)
                    .labelsHidden().fixedSize().frame(minHeight: 44)
                    .accessibilityIdentifier("\(node.id):stepper")
                    .accessibilityLabel(node.label ?? "")
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
        .disabled(node.disabled == true)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var field: some View {
        #if os(iOS)
        TextField(node.label ?? "", value: page, format: .number).keyboardType(.numberPad)
        #else
        TextField(node.label ?? "", value: page, format: .number)
        #endif
    }
}
