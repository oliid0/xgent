// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "XgentNativeUI",
    platforms: [.iOS("26.0"), .macOS("15.0")],
    products: [.library(name: "XgentNativeUI", type: .static, targets: ["XgentNativeUI"])],
    dependencies: [
        .package(url: "https://github.com/gonzalezreal/swift-markdown-ui", exact: "2.4.1"),
        .package(url: "https://github.com/tevelee/SwiftUI-Flow", exact: "3.5.1"),
        .package(url: "https://github.com/JohnSundell/Splash", exact: "0.16.0"),
        .package(url: "https://github.com/apple/swift-collections", exact: "1.2.1"),
        .package(url: "https://github.com/siteline/swiftui-introspect", exact: "26.0.1"),
        .package(url: "https://github.com/kean/Nuke", exact: "13.2.0"),
        .package(url: "https://github.com/swhitty/SwiftDraw", exact: "0.29.0"),
        .package(url: "https://github.com/mchakravarty/CodeEditorView", exact: "0.16.0"),
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", exact: "1.19.6"),
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", exact: "1.20.0"),
        .package(url: "https://github.com/danielsaidi/SystemNotification", exact: "1.4.1"),
    ],
    targets: [
        .target(name: "XgentNativeUI", dependencies: [
            .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            .product(name: "Flow", package: "SwiftUI-Flow"),
            .product(name: "Splash", package: "Splash"),
            .product(name: "OrderedCollections", package: "swift-collections"),
            .product(name: "SwiftUIIntrospect", package: "swiftui-introspect"),
            .product(name: "Nuke", package: "Nuke"),
            .product(name: "NukeUI", package: "Nuke"),
            .product(name: "SwiftDraw", package: "SwiftDraw"),
            .product(name: "CodeEditorView", package: "CodeEditorView"),
            .product(name: "LanguageSupport", package: "CodeEditorView"),
            .product(name: "SwiftTerm", package: "SwiftTerm"),
            .product(name: "SystemNotification", package: "SystemNotification"),
        ], path: ".", exclude: ["Tests"]),
        .testTarget(name: "XgentNativeUITests", dependencies: [
            "XgentNativeUI", .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            .product(name: "Nuke", package: "Nuke"),
            .product(name: "LanguageSupport", package: "CodeEditorView"),
            .product(name: "SnapshotTesting", package: "swift-snapshot-testing"),
            .product(name: "SwiftTerm", package: "SwiftTerm"),
        ],
                    path: "Tests"),
    ],
    swiftLanguageVersions: [.v5]
)
