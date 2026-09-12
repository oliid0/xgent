import SwiftUI

struct XgentGlassSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(.background, in: RoundedRectangle(cornerRadius: 20))
        } else {
            #if compiler(>=6.2)
            if #available(iOS 26.0, macOS 26.0, *) {
                content.glassEffect(.regular, in: .rect(cornerRadius: 20))
            } else {
                content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            }
            #else
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            #endif
        }
    }
}

struct XgentNodeChildren: View {
    let nodes: [XgentNode]
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        ForEach(nodes) { node in
            XgentNodeView(node: node, document: document, model: model)
        }
    }
}

struct XgentNodeView: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var children: XgentNodeChildren {
        XgentNodeChildren(nodes: node.children ?? [], document: document, model: model)
    }
    var textBinding: Binding<String> {
        Binding(get: { model.value(node, in: document).text },
                set: { model.send(node, in: document, value: .string($0), editing: true) })
    }
    var boolBinding: Binding<Bool> {
        Binding(get: { model.value(node, in: document).boolean },
                set: { model.send(node, in: document, value: .bool($0), editing: true) })
    }

    var body: some View {
        generatedContent
            .padding(CGFloat(node.padding ?? 0))
            .frame(maxWidth: node.fill == true ? .infinity : nil,
                   alignment: .leading)
            .disabled(node.disabled == true || model.isBusy(node, in: document))
            .accessibilityIdentifier(node.id)
    }

    var picker: some View {
        Picker(node.label ?? "", selection: textBinding) {
            ForEach(node.options ?? []) { option in
                Text(option.label).tag(option.value).disabled(option.disabled == true)
            }
        }
    }

    @ViewBuilder var nativeButton: some View {
        let button = Button(role: node.destructive == true ? .destructive : nil) {
            model.send(node, in: document)
        } label: {
            nodeLabel.frame(minHeight: 32)
        }
        #if compiler(>=6.2)
        if #available(iOS 26.0, macOS 26.0, *) {
            if node.prominent == true { button.buttonStyle(.glassProminent) }
            else { button.buttonStyle(.glass) }
        } else {
            if node.prominent == true { button.buttonStyle(.borderedProminent) }
            else { button.buttonStyle(.bordered) }
        }
        #else
        if node.prominent == true { button.buttonStyle(.borderedProminent) }
        else { button.buttonStyle(.bordered) }
        #endif
    }
}

struct XgentPresentationView: View {
    @ObservedObject var model: XgentPresentationModel

    private var root: XgentDocument? { model.documents.last { $0.mode == .root } }
    private var sheet: XgentDocument? { model.documents.first { $0.mode == .sheet } }

    var body: some View {
        XgentRootLayout(model: model)
        .background { Rectangle().fill(.background).ignoresSafeArea() }
        .preferredColorScheme(root?.colorScheme)
        .sheet(item: Binding(get: { sheet }, set: { if $0 == nil, let sheet { model.dismiss(sheet) } })) { document in
            XgentSheetView(document: document, model: model)
        }
        .modifier(XgentAlerts(model: model, enabled: sheet == nil))
    }
}

private enum XgentAlertItem: Identifiable {
    case confirmation(XgentDocument)
    case failure(String)

    var id: String {
        switch self {
        case .confirmation(let document): return document.surface
        case .failure(let message): return "failure:\(message)"
        }
    }
}

private struct XgentAlerts: ViewModifier {
    @ObservedObject var model: XgentPresentationModel
    let enabled: Bool

    private var item: XgentAlertItem? {
        guard enabled else { return nil }
        if let message = model.error { return .failure(message) }
        return model.documents.last { $0.mode == .alert }.map(XgentAlertItem.confirmation)
    }

    func body(content: Content) -> some View {
        content.alert(item: Binding(get: { item }, set: { value in
            // SwiftUI also clears the binding after the primary button. Cancellation
            // belongs to the explicit cancel button; this setter must never send it.
            if value == nil, let current = item, case .failure = current { model.error = nil }
        })) { item in
            switch item {
            case .failure(let message):
                return Alert(title: Text("Action failed"), message: Text(message),
                             dismissButton: .default(Text("OK")) { model.error = nil })
            case .confirmation(let document):
            let buttons = document.nodes.filter { $0.kind == .button }
            let confirm = buttons.first
            let cancel = buttons.dropFirst().first
            let message = document.nodes.filter { $0.kind == .text }.compactMap(\.text).joined(separator: "\n\n")
            let action: Alert.Button = confirm?.destructive == true
                ? .destructive(Text(confirm?.label ?? "OK")) { if let confirm { model.send(confirm, in: document) } }
                : .default(Text(confirm?.label ?? "OK")) { if let confirm { model.send(confirm, in: document) } }
            return Alert(title: Text(document.title), message: Text(message), primaryButton: action,
                         secondaryButton: .cancel(Text(cancel?.label ?? "Cancel")) {
                if let cancel { model.send(cancel, in: document) } else { model.dismiss(document) }
            })
            }
        }
    }
}

private struct XgentSheetView: View {
    let initialDocument: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    init(document: XgentDocument, model: XgentPresentationModel) {
        self.initialDocument = document
        self.model = model
    }

    // Sheet identity survives updates: read the live document, not the opening snapshot.
    private var document: XgentDocument {
        model.documents.first { $0.id == initialDocument.id } ?? initialDocument
    }

    private var nextSheet: XgentDocument? {
        let sheets = model.documents.filter { $0.mode == .sheet }
        guard let index = sheets.firstIndex(where: { $0.id == document.id }), index + 1 < sheets.count else { return nil }
        return sheets[index + 1]
    }

    var body: some View {
        NavigationStack {
            List {
                    XgentNodeChildren(nodes: document.nodes.filter { $0.id != "back" }, document: document, model: model)
            }
            #if os(iOS)
            .listStyle(.insetGrouped)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationTitle(document.title)
            .toolbar {
                if let back = document.nodes.first(where: { $0.id == "back" }) {
                    ToolbarItem(placement: .cancellationAction) {
                        XgentNodeView(node: back, document: document, model: model)
                    }
                }
                if document.dismissAction != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button { model.dismiss(document) } label: {
                            Image(systemName: "xmark").frame(minWidth: 32, minHeight: 32)
                        }.accessibilityLabel(Text("Close"))
                    }
                }
            }
        }
        .frame(minWidth: 300, minHeight: 360)
        .preferredColorScheme(document.colorScheme)
        .interactiveDismissDisabled(document.dismissAction == nil)
        .sheet(item: Binding(get: { nextSheet }, set: { if $0 == nil, let nextSheet { model.dismiss(nextSheet) } })) { next in
            AnyView(XgentSheetView(document: next, model: model))
        }
        .modifier(XgentAlerts(model: model, enabled: nextSheet == nil))
    }
}
