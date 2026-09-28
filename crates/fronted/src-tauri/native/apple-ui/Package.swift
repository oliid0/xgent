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
    ],
    targets: [
        .target(name: "XgentNativeUI", dependencies: [
            .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            .product(name: "Flow", package: "SwiftUI-Flow"),
            .product(name: "Splash", package: "Splash"),
        ], path: ".", exclude: ["Tests"]),
        .testTarget(name: "XgentNativeUITests", dependencies: [
            "XgentNativeUI", .product(name: "MarkdownUI", package: "swift-markdown-ui"),
        ],
                    path: "Tests"),
    ],
    swiftLanguageVersions: [.v5]
)
