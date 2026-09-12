import SwiftUI
import UniformTypeIdentifiers

// Semantic layout mappings shared by all native screens. Business state remains in TS.
extension XgentNodeView {
    @ViewBuilder var nodeLabel: some View {
        if let icon = node.icon { Label(node.label ?? "", systemImage: icon) }
        else { Text(node.label ?? "") }
    }

    var navigationRow: some View {
        Button { model.send(node, in: document) } label: {
            HStack(spacing: 12) {
                if let icon = node.icon { Image(systemName: icon).frame(width: 24) }
                VStack(alignment: .leading, spacing: 4) {
                    Text(node.label ?? "")
                    if let text = node.text, !text.isEmpty {
                        Text(text).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                if node.selected == true { Image(systemName: "checkmark").foregroundStyle(.tint) }
                else { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
            }.frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    var composer: some View {
        VStack(alignment: .leading, spacing: 8) { children }
            .padding(12).modifier(XgentGlassSurface())
            .padding(.horizontal, 12).padding(.bottom, 8)
    }

    var chatLayout: some View {
        VStack(spacing: 0) {
            ForEach((node.children ?? []).filter { $0.kind != .composer }) { child in
                XgentNodeView(node: child, document: document, model: model)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ForEach((node.children ?? []).filter { $0.kind == .composer }) { child in
                XgentNodeView(node: child, document: document, model: model)
            }
        }
    }

    var composerInput: some View {
        TextField(node.label ?? "", text: textBinding, axis: .vertical)
            .lineLimit(1...6).textFieldStyle(.plain)
            .font(.body).padding(.vertical, 8)
            .accessibilityLabel(node.label ?? "")
    }

    var filePicker: some View {
        XgentAttachmentPicker(node: node, document: document, model: model)
    }

    var iconButton: some View {
        Button { model.send(node, in: document) } label: {
            Image(systemName: node.icon ?? "ellipsis")
                .font(.system(size: 20)).frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(node.prominent == true ? Color.white : Color.primary)
        .modifier(XgentGlassCircle(prominent: node.prominent == true))
        .accessibilityLabel(node.label ?? "")
    }
}

struct XgentRootLayout: View {
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var root: XgentDocument? { model.documents.last { $0.mode == .root } }
    private var sidebar: XgentDocument? { model.documents.last { $0.mode == .sidebar } }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                if let root {
                    XgentNodeChildren(nodes: root.nodes, document: root, model: model)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .background(.background)
                        .accessibilityIdentifier("xgent-native-root")
                        .onAppear { NSLog("XgentNativeUI root rendered") }
                        .preferredColorScheme(root.colorScheme)
                        .accessibilityHidden(sidebar != nil)
                        .offset(x: sidebar == nil ? 0 : min(340, geometry.size.width * 0.82))
                }
                if let sidebar {
                    Button { model.dismiss(sidebar) } label: { Color.black.opacity(0.1) }
                        .buttonStyle(.plain).accessibilityLabel(Text("Close sidebar"))
                    XgentNodeChildren(nodes: sidebar.nodes, document: sidebar, model: model)
                        .frame(width: min(340, geometry.size.width * 0.82), height: geometry.size.height)
                        .background(.background)
                        .preferredColorScheme(sidebar.colorScheme)
                        .transition(.move(edge: .leading))
                        .gesture(DragGesture().onEnded {
                            if $0.translation.width < -60 { model.dismiss(sidebar) }
                        })
                }
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: sidebar?.id)
            .clipped()
        }
    }
}
