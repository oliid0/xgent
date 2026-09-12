import SwiftUI

extension XgentPresentationTheme {
    static let fallback = XgentPresentationTheme(
        light: XgentPalette(accent: "#0088ff", accentText: "#006edc", background: "#f5f5f7",
                            surface: "#ffffff", card: "#ffffff", popover: "#ffffff", muted: "#eeeeef",
                            text: "#0d0d0d", secondaryText: "#6e6e73", disabledText: "#8e8e93",
                            border: "#0000001a", emphasizedBorder: "#d9d9d9", shadow: "#000000"),
        dark: XgentPalette(accent: "#0a84ff", accentText: "#6eb4ff", background: "#171717",
                           surface: "#212121", card: "#2a2a2a", popover: "#2a2a2a", muted: "#303030",
                           text: "#ececec", secondaryText: "#b4b4b4", disabledText: "#7c7c80",
                           border: "#ffffff1f", emphasizedBorder: "#4a4a4a", shadow: "#000000"),
        radius: XgentRadii(inner: 8, element: 14, container: 26, overlay: 32, chat: 28),
        spacing: XgentSpacing(xs: 4, sm: 8, md: 12, lg: 16, xl: 24),
        control: XgentControlMetrics(small: 32, medium: 40, large: 44),
        typography: XgentTypography(caption: 12, supporting: 13, body: 15),
        motion: XgentMotion(fast: 120, medium: 240, slow: 650, curve: [0.2, 0, 0, 1]),
        material: XgentMaterial(
            light: XgentMaterialMode(surfaceOpacity: 0.8, popoverOpacity: 0.88, shadowOpacity: 0.1),
            dark: XgentMaterialMode(surfaceOpacity: 0.72, popoverOpacity: 0.8, shadowOpacity: 0.34),
            blur: 28, saturation: 1.45
        ),
        fontScale: 1
    )

    func palette(for scheme: ColorScheme) -> XgentPalette { scheme == .dark ? dark : light }
}

private struct XgentPresentationThemeKey: EnvironmentKey {
    static let defaultValue = XgentPresentationTheme.fallback
}

extension EnvironmentValues {
    var xgentPresentationTheme: XgentPresentationTheme {
        get { self[XgentPresentationThemeKey.self] }
        set { self[XgentPresentationThemeKey.self] = newValue }
    }
}

extension Color {
    init(xgentHex: String) {
        let hex = xgentHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var bits: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&bits)
        let hasAlpha = hex.count == 8
        self.init(.sRGB,
                  red: Double((bits >> (hasAlpha ? 24 : 16)) & 0xff) / 255,
                  green: Double((bits >> (hasAlpha ? 16 : 8)) & 0xff) / 255,
                  blue: Double((bits >> (hasAlpha ? 8 : 0)) & 0xff) / 255,
                  opacity: hasAlpha ? Double(bits & 0xff) / 255 : 1)
    }
}

struct XgentPresentationThemeModifier: ViewModifier {
    @Environment(\.colorScheme) private var systemScheme
    let theme: XgentPresentationTheme
    let appearance: XgentDocument.Appearance

    private var scheme: ColorScheme {
        switch appearance {
        case .light: return .light
        case .dark: return .dark
        case .system: return systemScheme
        }
    }

    func body(content: Content) -> some View {
        let palette = theme.palette(for: scheme)
        content
            .environment(\.xgentPresentationTheme, theme)
            .environment(\.font, .system(size: CGFloat(17 * theme.fontScale)))
            .tint(Color(xgentHex: palette.accent))
    }
}

struct XgentThemeBackground: View {
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    var body: some View { Color(xgentHex: theme.palette(for: colorScheme).background) }
}

struct XgentGlassSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    var radius: CGFloat?
    var floating: Bool

    init(radius: CGFloat? = nil, floating: Bool = false) {
        self.radius = radius
        self.floating = floating
    }

    @ViewBuilder func body(content: Content) -> some View {
        let cornerRadius = radius ?? CGFloat(theme.radius.container)
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let palette = theme.palette(for: colorScheme)
        let material = colorScheme == .dark ? theme.material.dark : theme.material.light
        let surfaceColor = Color(xgentHex: floating ? palette.popover : palette.surface)
        let surfaceOpacity = floating ? material.popoverOpacity : material.surfaceOpacity
        let shadowOpacity = floating ? material.shadowOpacity : 0
        if reduceTransparency {
            content.background(surfaceColor, in: shape)
                .overlay(shape.stroke(Color(xgentHex: palette.border), lineWidth: 1))
                .shadow(color: Color(xgentHex: palette.shadow).opacity(shadowOpacity),
                        radius: floating ? CGFloat(min(theme.material.blur / 2, 18)) : 0,
                        y: floating ? 6 : 0)
        } else {
            #if compiler(>=6.2)
            if #available(iOS 26.0, macOS 26.0, *) {
                content
                    .glassEffect(
                        .regular.tint(surfaceColor.opacity(surfaceOpacity)),
                        in: .rect(cornerRadius: cornerRadius)
                    )
                    .overlay(shape.stroke(Color.white.opacity(colorScheme == .dark ? 0.12 : 0.3), lineWidth: 0.7))
                    .shadow(color: Color(xgentHex: palette.shadow).opacity(shadowOpacity),
                            radius: floating ? CGFloat(min(theme.material.blur / 2, 18)) : 0,
                            y: floating ? 6 : 0)
            } else {
                polyfilledGlass(content: content, shape: shape, palette: palette,
                                surfaceColor: surfaceColor, surfaceOpacity: surfaceOpacity,
                                shadowOpacity: shadowOpacity)
            }
            #else
            polyfilledGlass(content: content, shape: shape, palette: palette,
                            surfaceColor: surfaceColor, surfaceOpacity: surfaceOpacity,
                            shadowOpacity: shadowOpacity)
            #endif
        }
    }

    private func polyfilledGlass(
        content: Content,
        shape: RoundedRectangle,
        palette: XgentPalette,
        surfaceColor: Color,
        surfaceOpacity: Double,
        shadowOpacity: Double
    ) -> some View {
        content
            .background(.regularMaterial, in: shape)
            .background(surfaceColor.opacity(surfaceOpacity), in: shape)
            .overlay(shape.stroke(Color(xgentHex: palette.border), lineWidth: 1))
            .overlay {
                shape.stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(colorScheme == .dark ? 0.12 : 0.42), .clear],
                        startPoint: .top,
                        endPoint: .center
                    ),
                    lineWidth: 0.7
                )
            }
            .shadow(color: Color(xgentHex: palette.shadow).opacity(shadowOpacity),
                    radius: floating ? CGFloat(min(theme.material.blur / 2, 18)) : 0,
                    y: floating ? 6 : 0)
    }
}

private struct XgentAccessibilityModifier: ViewModifier {
    let node: XgentNode

    @ViewBuilder func body(content: Content) -> some View {
        if let label = node.accessibilityLabel {
            content.accessibilityLabel(label)
                .accessibilityHint(node.accessibilityHint ?? "")
                .accessibilityValue(node.accessibilityValue ?? "")
        } else if let hint = node.accessibilityHint {
            content.accessibilityHint(hint)
                .accessibilityValue(node.accessibilityValue ?? "")
        } else if let value = node.accessibilityValue {
            content.accessibilityValue(value)
        } else {
            content
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
    @Environment(\.dynamicTypeSize) var dynamicTypeSize
    @Environment(\.xgentPresentationTheme) var presentationTheme
    @Environment(\.colorScheme) var colorScheme
    @State var expanded = false

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
    var numberBinding: Binding<Double> {
        Binding(
            get: {
                if case .number(let number) = model.value(node, in: document) { return number }
                return node.minimum ?? 0
            },
            set: { model.send(node, in: document, value: .number($0), editing: true) }
        )
    }

    private var frameAlignment: Alignment {
        switch node.alignment {
        case "center": return .center
        case "trailing": return .trailing
        default: return .leading
        }
    }

    private var controlSize: ControlSize {
        switch node.size {
        case "small": return .small
        case "large": return .large
        default: return .regular
        }
    }

    var body: some View {
        generatedContent
            .padding(CGFloat(node.padding ?? 0))
            .padding(.leading, CGFloat(node.indent ?? 0))
            .frame(width: node.width.map(CGFloat.init), height: node.height.map(CGFloat.init),
                   alignment: frameAlignment)
            .frame(minWidth: node.minWidth.map(CGFloat.init),
                   maxWidth: node.fill == true ? .infinity : node.maxWidth.map(CGFloat.init),
                   minHeight: node.minHeight.map(CGFloat.init),
                   maxHeight: node.fill == true ? .infinity : node.maxHeight.map(CGFloat.init),
                   alignment: frameAlignment)
            .lineLimit(node.maxLines)
            .fixedSize(horizontal: node.wrap == false, vertical: false)
            .controlSize(controlSize)
            .disabled(node.disabled == true || model.isBusy(node, in: document))
            .accessibilityIdentifier(node.id)
            .modifier(XgentAccessibilityModifier(node: node))
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
        .buttonBorderShape(.roundedRectangle(radius: CGFloat(presentationTheme.radius.element)))
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

    @ViewBuilder private var groupedRoot: some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, macOS 26.0, *) {
            GlassEffectContainer(spacing: CGFloat((root?.theme ?? .fallback).spacing.sm)) {
                XgentRootLayout(model: model)
            }
        } else {
            XgentRootLayout(model: model)
        }
        #else
        XgentRootLayout(model: model)
        #endif
    }

    var body: some View {
        groupedRoot
        .background { XgentThemeBackground().ignoresSafeArea() }
        .preferredColorScheme(root?.colorScheme)
        .sheet(item: Binding(get: { sheet }, set: { if $0 == nil, let sheet { model.dismiss(sheet) } })) { document in
            XgentSheetView(document: document, model: model)
        }
        .modifier(XgentAlerts(model: model, enabled: sheet == nil))
        .modifier(XgentPresentationThemeModifier(
            theme: root?.theme ?? .fallback,
            appearance: root?.appearance ?? .system
        ))
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
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    XgentNodeChildren(
                        nodes: document.nodes.filter { $0.id != "back" },
                        document: document,
                        model: model
                    )
                }
                .padding(16)
            }
            .background { XgentThemeBackground().ignoresSafeArea() }
            #if os(iOS)
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
        #if os(iOS)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        #endif
        .frame(minWidth: 300, minHeight: 360)
        .preferredColorScheme(document.colorScheme)
        .interactiveDismissDisabled(document.dismissAction == nil)
        .sheet(item: Binding(get: { nextSheet }, set: { if $0 == nil, let nextSheet { model.dismiss(nextSheet) } })) { next in
            AnyView(XgentSheetView(document: next, model: model))
        }
        .modifier(XgentAlerts(model: model, enabled: nextSheet == nil))
        .modifier(XgentPresentationThemeModifier(
            theme: document.theme ?? .fallback,
            appearance: document.appearance
        ))
    }
}
