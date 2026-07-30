// swift-tools-version:5.8

import PackageDescription

let package = Package(
    name: "tauri-plugin-browser-automation",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "tauri-plugin-browser-automation",
            type: .static,
            targets: ["tauri-plugin-browser-automation"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-browser-automation",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
