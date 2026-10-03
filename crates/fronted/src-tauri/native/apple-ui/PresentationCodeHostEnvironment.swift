import SwiftUI

struct XgentCodeHostEnvironment {
    let theme: XgentPresentationTheme
    let colorScheme: ColorScheme
    let dynamicTypeSize: DynamicTypeSize
    let locale: Locale
    let layoutDirection: LayoutDirection
    let enabled: Bool
}

@MainActor
struct XgentCodeHostRoot: View {
    @ObservedObject var source: XgentCodeHostSource
    let lease: UUID
    let configuration: XgentCodeEditor
    let environment: XgentCodeHostEnvironment
    let undo: UndoManager

    var body: some View {
        configuration.retained(binding: source.binding(lease))
            .modifier(XgentCodeHostAvailability(enabled: configuration.enabled && environment.enabled, source: source))
            .disabled(!configuration.enabled || !environment.enabled)
            .environment(\.xgentPresentationTheme, environment.theme)
            .environment(\.colorScheme, environment.colorScheme)
            .environment(\.locale, environment.locale)
            .environment(\.layoutDirection, environment.layoutDirection)
            .environment(\.undoManager, undo)
            .dynamicTypeSize(environment.dynamicTypeSize)
    }
}
