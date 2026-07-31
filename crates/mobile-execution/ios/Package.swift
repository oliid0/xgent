// swift-tools-version:5.8

import PackageDescription

let package = Package(
    name: "tauri-plugin-mobile-execution",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "tauri-plugin-mobile-execution",
            type: .static,
            targets: ["tauri-plugin-mobile-execution"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .binaryTarget(
            name: "ios_system",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.2/ios_system.xcframework.zip",
            checksum: "f8e1364037de546809065ecdf804277fa7b95faffc32604e91ecb4de44d6294e"
        ),
        .binaryTarget(
            name: "awk",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.2/awk.xcframework.zip",
            checksum: "73abc0d502eab50e6bbdd0e49b0cf592f3a85b3843c43de6d7f42c27cde9b953"
        ),
        .binaryTarget(
            name: "curl_ios",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.2/curl_ios.xcframework.zip",
            checksum: "7338fb9ae8094356c8cd523cfda9e4c60b52d710488432eb64cf57731b388dd2"
        ),
        .binaryTarget(
            name: "files",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.2/files.xcframework.zip",
            checksum: "d0643e2244009fc5279f1f969c6da47ca197b4e7c9dac27dea09ba0a5f1567d7"
        ),
        .binaryTarget(
            name: "shell",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.2/shell.xcframework.zip",
            checksum: "876b709c1b76cbc1748d434fcbc2cea1aea2e281572e5fadc40244dd8a549757"
        ),
        .binaryTarget(
            name: "tar",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.2/tar.xcframework.zip",
            checksum: "6ffe4ed265060f971df229dd1d2bff90e7bc78c80c50dcc3a0a633face440bc4"
        ),
        .binaryTarget(
            name: "text",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.2/text.xcframework.zip",
            checksum: "697bee697b509d0dc8acc156a7430f453c29878d8af273adfb8902643c70ea0f"
        ),
        .binaryTarget(
            name: "ssh_cmd",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.2/ssh_cmd.xcframework.zip",
            checksum: "342065209123f54c92eb78a0fbda579e61948443e5f60e41d8fe356a3fe8f2ff"
        ),
        .binaryTarget(
            name: "dash",
            url: "https://github.com/holzschu/ios_system/releases/download/Auxiliary/dash.xcframework.zip",
            checksum: "9a30ac6b3780dd68d2268d10467902214e32333e980c59090faa6099f0d250fc"
        ),
        .binaryTarget(
            name: "vim",
            url: "https://github.com/holzschu/vim/releases/download/ios_1.0/vim.xcframework.zip",
            checksum: "02acb74bec3e6b4ba9c120873a19a770773e3c3e2d141365808a9342ddf41fe7"
        ),
        .binaryTarget(
            name: "lg2",
            url: "https://github.com/holzschu/libgit2/releases/download/ios_1.0/lg2.xcframework.zip",
            checksum: "7d205a771be8d120a80d2f7281135dfffd21a3713c86eb4f1957638f6b4b365e"
        ),
        .binaryTarget(
            name: "ffmpeg",
            url: "https://github.com/holzschu/ios_system/releases/download/Auxiliary/ffmpeg.xcframework.zip",
            checksum: "627a9392a8d4704e4e04636692e3baeacb7af4f273e61fe676270aa16b1ef371"
        ),
        .binaryTarget(
            name: "ffprobe",
            url: "https://github.com/holzschu/ios_system/releases/download/Auxiliary/ffprobe.xcframework.zip",
            checksum: "c66df5198becb1e0432c27c8f0df628fa185224c9f0bcff2039e3bd21246b130"
        ),
        .target(
            name: "tauri-plugin-mobile-execution",
            dependencies: [
                .byName(name: "Tauri"),
                "ios_system",
                "awk",
                "curl_ios",
                "files",
                "shell",
                "tar",
                "text",
                "ssh_cmd",
                "dash",
                "vim",
                "lg2",
                "ffmpeg",
                "ffprobe",
            ],
            path: "Sources",
            resources: [
                // SwiftPM's `.process` rule flattens directory resources. Vim's
                // runtime intentionally contains duplicate basenames in
                // different subdirectories, so those trees must be copied while
                // preserving their hierarchy.
                .process("Resources/commandDictionary.plist"),
                .process("Resources/extraCommandsDictionary.plist"),
                .copy("Resources/vim"),
                .copy("Resources/terminfo"),
                .copy("Resources/cacert.pem"),
                .copy("Resources/Legal"),
            ]
        ),
    ]
)
