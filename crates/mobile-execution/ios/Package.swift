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
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.4/ios_system.xcframework.zip",
            checksum: "6973c1c14a66cdc110a5be7d62991af4546124bd0d9773b5391694b3a93a5be0"
        ),
        .binaryTarget(
            name: "awk",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.4/awk.xcframework.zip",
            checksum: "6898b01913261eee194edcb464212d4af6bc33355b1e286bbbd17f3f878c1706"
        ),
        .binaryTarget(
            name: "curl_ios",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.4/curl_ios.xcframework.zip",
            checksum: "2a0020ce4904ea71e83c8daa86e99515b322981abc8ab2092b700661bcc880cd"
        ),
        .binaryTarget(
            name: "files",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.4/files.xcframework.zip",
            checksum: "02d6522f5e1adc3b472f7aaa53910f049e6c5829e07c7e3005cf2a0d5f9f423a"
        ),
        .binaryTarget(
            name: "shell",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.4/shell.xcframework.zip",
            checksum: "78d71828b89c83741a8f7e857f0d065da72952558fd7deb806f5748c3801fd95"
        ),
        .binaryTarget(
            name: "tar",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.4/tar.xcframework.zip",
            checksum: "9bf482b29ea95bc643bfaa06b249394afed188e40482db055625f4928ffedc48"
        ),
        .binaryTarget(
            name: "text",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.4/text.xcframework.zip",
            checksum: "2450f309d0793490136a24f9af02c42fb712b327571cb44312fe330e87a156f2"
        ),
        .binaryTarget(
            name: "ssh_cmd",
            url: "https://github.com/holzschu/ios_system/releases/download/v3.0.4/ssh_cmd.xcframework.zip",
            checksum: "190597a3ec09d6bc250e31caa8b08ecc2b6f27ecbd6b24fda84065ccd2be309e"
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
            exclude: ["Resources"]
        ),
    ]
)
