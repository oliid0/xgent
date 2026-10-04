import SwiftUI

struct XgentComposerSuggestions: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @ScaledMetric(relativeTo: .body) private var maximumHeight: CGFloat = 180

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let label = node.label {
                    Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 4)
                        .accessibilityAddTraits(.isHeader)
                }
                ForEach(node.children ?? []) { child in
                    if child.action != nil {
                        Button { model.send(child, in: document) } label: {
                            HStack(alignment: .center, spacing: 12) {
                                if let icon = child.icon { Image(systemName: icon).frame(width: 24).accessibilityHidden(true) }
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(child.label ?? "").font(.body).fixedSize(horizontal: false, vertical: true)
                                    if let text = child.text, !text.isEmpty {
                                        Text(text).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 4)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).disabled(child.disabled == true || model.isBusy(child, in: document))
                        .accessibilityIdentifier(child.id)
                    } else {
                        Text(child.text ?? "").font(.subheadline).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true).padding(14)
                    }
                }
            }
        }
        .frame(maxHeight: min(maximumHeight, 260))
        .fixedSize(horizontal: false, vertical: true)
        .modifier(XgentGlassSurface(radius: 22, floating: true))
        .accessibilityIdentifier(node.id)
    }
}
