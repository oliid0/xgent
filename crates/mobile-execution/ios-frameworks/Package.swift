// swift-tools-version:5.8

import PackageDescription

private struct PythonFramework {
    let target: String
    let file: String
}

private let pythonFrameworks = [
    PythonFramework(target: "python3_ios_runtime", file: "python3_ios"),
    PythonFramework(target: "python3_ios_asyncio", file: "python3_ios-_asyncio"),
    PythonFramework(target: "python3_ios_bisect", file: "python3_ios-_bisect"),
    PythonFramework(target: "python3_ios_blake2", file: "python3_ios-_blake2"),
    PythonFramework(target: "python3_ios_bz2", file: "python3_ios-_bz2"),
    PythonFramework(target: "python3_ios_codecs_cn", file: "python3_ios-_codecs_cn"),
    PythonFramework(target: "python3_ios_codecs_hk", file: "python3_ios-_codecs_hk"),
    PythonFramework(target: "python3_ios_codecs_iso2022", file: "python3_ios-_codecs_iso2022"),
    PythonFramework(target: "python3_ios_codecs_jp", file: "python3_ios-_codecs_jp"),
    PythonFramework(target: "python3_ios_codecs_kr", file: "python3_ios-_codecs_kr"),
    PythonFramework(target: "python3_ios_codecs_tw", file: "python3_ios-_codecs_tw"),
    PythonFramework(target: "python3_ios_contextvars", file: "python3_ios-_contextvars"),
    PythonFramework(target: "python3_ios_crypt", file: "python3_ios-_crypt"),
    PythonFramework(target: "python3_ios_csv", file: "python3_ios-_csv"),
    PythonFramework(target: "python3_ios_ctypes", file: "python3_ios-_ctypes"),
    PythonFramework(target: "python3_ios_datetime", file: "python3_ios-_datetime"),
    PythonFramework(target: "python3_ios_dbm", file: "python3_ios-_dbm"),
    PythonFramework(target: "python3_ios_decimal", file: "python3_ios-_decimal"),
    PythonFramework(target: "python3_ios_elementtree", file: "python3_ios-_elementtree"),
    PythonFramework(target: "python3_ios_hashlib", file: "python3_ios-_hashlib"),
    PythonFramework(target: "python3_ios_heapq", file: "python3_ios-_heapq"),
    PythonFramework(target: "python3_ios_json", file: "python3_ios-_json"),
    PythonFramework(target: "python3_ios_lsprof", file: "python3_ios-_lsprof"),
    PythonFramework(target: "python3_ios_md5", file: "python3_ios-_md5"),
    PythonFramework(target: "python3_ios_multibytecodec", file: "python3_ios-_multibytecodec"),
    PythonFramework(target: "python3_ios_multiprocessing", file: "python3_ios-_multiprocessing"),
    PythonFramework(target: "python3_ios_opcode", file: "python3_ios-_opcode"),
    PythonFramework(target: "python3_ios_pickle", file: "python3_ios-_pickle"),
    PythonFramework(target: "python3_ios_posixshmem", file: "python3_ios-_posixshmem"),
    PythonFramework(target: "python3_ios_posixsubprocess", file: "python3_ios-_posixsubprocess"),
    PythonFramework(target: "python3_ios_queue", file: "python3_ios-_queue"),
    PythonFramework(target: "python3_ios_random", file: "python3_ios-_random"),
    PythonFramework(target: "python3_ios_sha1", file: "python3_ios-_sha1"),
    PythonFramework(target: "python3_ios_sha256", file: "python3_ios-_sha256"),
    PythonFramework(target: "python3_ios_sha3", file: "python3_ios-_sha3"),
    PythonFramework(target: "python3_ios_sha512", file: "python3_ios-_sha512"),
    PythonFramework(target: "python3_ios_socket", file: "python3_ios-_socket"),
    PythonFramework(target: "python3_ios_sqlite3", file: "python3_ios-_sqlite3"),
    PythonFramework(target: "python3_ios_ssl", file: "python3_ios-_ssl"),
    PythonFramework(target: "python3_ios_statistics", file: "python3_ios-_statistics"),
    PythonFramework(target: "python3_ios_struct", file: "python3_ios-_struct"),
    PythonFramework(target: "python3_ios_zoneinfo", file: "python3_ios-_zoneinfo"),
    PythonFramework(target: "python3_ios_array", file: "python3_ios-array"),
    PythonFramework(target: "python3_ios_audioop", file: "python3_ios-audioop"),
    PythonFramework(target: "python3_ios_binascii", file: "python3_ios-binascii"),
    PythonFramework(target: "python3_ios_cmath", file: "python3_ios-cmath"),
    PythonFramework(target: "python3_ios_fcntl", file: "python3_ios-fcntl"),
    PythonFramework(target: "python3_ios_grp", file: "python3_ios-grp"),
    PythonFramework(target: "python3_ios_math", file: "python3_ios-math"),
    PythonFramework(target: "python3_ios_mmap", file: "python3_ios-mmap"),
    PythonFramework(target: "python3_ios_parser", file: "python3_ios-parser"),
    PythonFramework(target: "python3_ios_pyexpat", file: "python3_ios-pyexpat"),
    PythonFramework(target: "python3_ios_resource", file: "python3_ios-resource"),
    PythonFramework(target: "python3_ios_select", file: "python3_ios-select"),
    PythonFramework(target: "python3_ios_syslog", file: "python3_ios-syslog"),
    PythonFramework(target: "python3_ios_termios", file: "python3_ios-termios"),
    PythonFramework(target: "python3_ios_unicodedata", file: "python3_ios-unicodedata"),
    PythonFramework(target: "python3_ios_zlib", file: "python3_ios-zlib"),
]

private let nativeTargetNames = [
    "ios_system", "awk", "curl_ios", "files", "shell", "tar", "text", "ssh_cmd",
    "dash", "vim", "lg2", "ffmpeg", "ffprobe", "openssl", "libssh2", "freetype", "lua_ios",
    "harfbuzz", "libpng",
]

// Tauri compiles the Swift plugin into libapp.a, but binary dependencies of
// that static archive do not become dependencies of the generated Xcode app.
// The iOS project therefore consumes this binary-only product directly.
let package = Package(
    name: "XgentMobileShellFrameworks",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "XgentMobileShellFrameworks",
            targets: nativeTargetNames + pythonFrameworks.map(\.target)
        ),
    ],
    targets: [
        .binaryTarget(
            name: "harfbuzz",
            url: "https://github.com/holzschu/Python-aux/releases/download/1.0/harfbuzz.xcframework.zip",
            checksum: "9a983795826d1662ba354f563b19a7b980e4c744138b3afb68491991e2c8a66a"
        ),
        .binaryTarget(
            name: "libpng",
            url: "https://github.com/holzschu/Python-aux/releases/download/1.0/libpng.xcframework.zip",
            checksum: "30ff80e9a2c20d7f266e7f788e94e44b2e105ac9c8107b44eb91f6869d6d8aa4"
        ),
        // Required by ffmpeg/ffprobe and vim on iphoneos. Their simulator
        // slices do not expose the same dependency graph.
        .binaryTarget(
            name: "freetype",
            url: "https://github.com/holzschu/Python-aux/releases/download/1.0/freetype.xcframework.zip",
            checksum: "8fdf22c7911a2ea47c60df723a0ee268bd5606a1153023f338b3e6395149089e"
        ),
        .binaryTarget(
            name: "lua_ios",
            url: "https://github.com/holzschu/lua_ios/releases/download/1.0/lua_ios.xcframework.zip",
            checksum: "0ccdab671f31c20daf8833452cc36598b49f84441851d7142b305443425bc527"
        ),
        // Transitive dylibs are not embedded automatically for binary targets.
        // Checksums are verified against these exact release asset URLs.
        .binaryTarget(
            name: "openssl",
            url: "https://github.com/holzschu/openssl-apple/releases/download/v1.1.1w/openssl-dynamic.xcframework.zip",
            checksum: "329e8317cf9bee8e138da5d032330a7a1bd2473cf44c9c083cb2f0636abb8b80"
        ),
        .binaryTarget(
            name: "libssh2",
            url: "https://github.com/holzschu/libssh2-apple/releases/download/v1.11.0/libssh2-dynamic.xcframework.zip",
            checksum: "cacfe1789b197b727119f7e32f561eaf9acc27bf38cd19975b74fce107f868a6"
        ),
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
    ] + pythonFrameworks.map { framework in
        .binaryTarget(
            name: framework.target,
            path: "Frameworks/\(framework.file).xcframework"
        )
    }
)
