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
    @ObservedObject var state: XgentCodeHostState
    let parking: XgentCodeHostParking

    var body: some View {
        if let snapshot = state.snapshot {
            snapshot.configuration.retained(binding: source.binding(snapshot.lease))
                .modifier(XgentCodeHostAvailability(enabled: snapshot.configuration.enabled && snapshot.environment.enabled, source: source, parking: parking))
                .disabled(!snapshot.configuration.enabled || !snapshot.environment.enabled)
                .environment(\.xgentCodeHostParking, parking)
                .environment(\.xgentPresentationTheme, snapshot.environment.theme)
                .environment(\.colorScheme, snapshot.environment.colorScheme)
                .environment(\.locale, snapshot.environment.locale)
                .environment(\.layoutDirection, snapshot.environment.layoutDirection)
                .dynamicTypeSize(snapshot.environment.dynamicTypeSize)
        }
    }
}
