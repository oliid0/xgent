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
    "dash", "vim", "lg2", "ffmpeg", "ffprobe",
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
    ] + pythonFrameworks.map { framework in
        .binaryTarget(
            name: framework.target,
            path: "Frameworks/\(framework.file).xcframework"
        )
    }
)
