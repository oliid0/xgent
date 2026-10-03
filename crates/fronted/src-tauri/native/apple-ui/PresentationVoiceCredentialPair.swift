import SwiftUI

struct XgentVoiceCredentialPair: View {
    let first: XgentNode
    let second: XgentNode?
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.dynamicTypeSize) private var textSize

    private func field(_ item: XgentNode) -> some View {
        XgentTextInput(node: item, document: document, model: model)
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: 16) {
            field(first)
            if let second { field(second) }
        }
    }

    var body: some View {
        if document.formFactor == "mobile" || textSize.isAccessibilitySize { vertical }
        else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    field(first).frame(minWidth: 240, maxWidth: .infinity)
                    if let second { field(second).frame(minWidth: 240, maxWidth: .infinity) }
                    else { Color.clear.frame(minWidth: 240, maxWidth: .infinity, maxHeight: 1) }
                }
                vertical
            }
        }
    }
}
