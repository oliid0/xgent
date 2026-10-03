import SwiftUI

struct XgentSpreadsheetSheets: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(node.options ?? []) { sheet in
                        Button {
                            model.send(node, in: document, value: .string(sheet.value))
                        } label: {
                            Text(sheet.label).lineLimit(1).padding(.horizontal, 12).padding(.vertical, 10)
                                .background(sheet.value == selected ? Color(xgentHex: theme.palette(for: scheme).muted) : .clear)
                                .overlay(alignment: .bottom) {
                                    Rectangle().fill(sheet.value == selected ? Color.accentColor : .clear).frame(height: 2)
                                }
                        }
                        .buttonStyle(.plain)
                        .id(sheet.value)
                        .disabled(node.disabled == true || sheet.disabled == true || model.isBusy(node, in: document))
                        .accessibilityIdentifier("\(node.id):\(sheet.value)")
                        .accessibilityAddTraits(sheet.value == selected ? .isSelected : [])
                    }
                }
            }
            .scrollIndicators(.hidden)
            .onChange(of: selected) { _, value in proxy.scrollTo(value) }
            .onAppear { proxy.scrollTo(selected) }
        }
        .frame(minWidth: 0, maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }

    private var selected: String { model.value(node, in: document).text }
}
