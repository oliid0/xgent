// swift-tools-version:5.8

import PackageDescription

let package = Package(
    name: "tauri-plugin-mobile-assistant",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "tauri-plugin-mobile-assistant",
            type: .static,
            targets: ["tauri-plugin-mobile-assistant"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-mobile-assistant",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
