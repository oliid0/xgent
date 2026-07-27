# Third-party notices

The XAgent mobile execution plugin is MIT licensed. It uses these independent
components without changing their upstream license terms.

## a-Shell-derived iOS execution

The WASI adapter in `ios/Sources/AShellWasmExecutor.swift` is derived from
a-Shell's `WasmKit.swift` and adapted into a headless Tauri plugin.

- Upstream: `https://github.com/holzschu/a-shell`
- License: BSD-3-Clause
- Copyright: Nicolas Holzschuch / AsheKube

Vim runtime data, terminfo entries, and the CA certificate bundle are copied
from pinned a-Shell commit `0a0614464ec65a9480f4d44f95a85273a33a6dfa` by
`scripts/mobile/prepare-ios-shell-resources.sh`. The terminal UI, Python, TeX,
and application-specific command layer are not incorporated.

## ios_system 3.0.2 and command frameworks

- Upstream: `https://github.com/holzschu/ios_system/tree/v3.0.2`
- License: BSD-3-Clause; One True Awk has its own permissive Lucent notice.
- Binary framework URLs and SwiftPM checksums are pinned in
  `ios/Package.swift`.

The linked command frameworks include the base command set plus curl, SSH
client commands, dash, Vim, lg2, ffmpeg, and ffprobe. Large Python and TeX
runtimes are not included.

## WasmKit 0.1.6

- Upstream commit: `827056b014e37da50e2645a7634fddb32e441f32`
- License: MIT
- Copyright: Akio Yasui and contributors

## PRoot 5.1.107.84 (Android only)

- Upstream: `https://github.com/termux/proot/tree/v5.1.107.84`
- License: GPL-2.0-or-later
- Included as a separate executable, not linked into XAgent.
- Corresponding source and reproduction details: `PROOT_SOURCE.md`.

## PRoot native dependencies (Android only)

- libandroid-shmem 0.7 — BSD-3-Clause
- libtalloc 2.4.3 — LGPL-3.0-or-later
- Binary distributor: the official Termux package repository.
- Package paths and SHA-256 digests are pinned in
  `scripts/mobile/prepare-proot-android.sh`.

## Alpine Linux minirootfs 3.22.5 (Android only)

- Distribution: `https://alpinelinux.org/`
- Archives: official `aarch64` and `x86_64` minirootfs release artifacts.
- Reproduction/inclusion script:
  `scripts/mobile/prepare-alpine-rootfs-android.sh`.
- The rootfs retains Alpine package metadata and installed-package license
  declarations. Additional packages installed by the user retain their own
  upstream licenses inside the PRoot environment.

## Android archive libraries

- Apache Commons Compress 1.27.1: Apache-2.0

The release workflow copies this notice, `PROOT_SOURCE.md`, and all full texts
under `LICENSES/` into both mobile application bundles. Android releases also
publish the exact PRoot source archive beside the APK.
