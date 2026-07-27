# PRoot corresponding source

The Android APK bundles PRoot as a separate executable invoked through
`ProcessBuilder`. XAgent itself remains MIT licensed; PRoot remains licensed
under GPL-2.0-or-later.

- Packaged binary version: `5.1.107.84`
- Binary distributor: Termux package repository
- Corresponding source commit: `b55e987fe2bd1c609291c16a4fa432814818cbdd`
- Upstream tag: `https://github.com/termux/proot/tree/v5.1.107.84`
- Termux build recipe: `https://github.com/termux/termux-packages/tree/master/packages/proot`
- Reproduction/inclusion script: `scripts/mobile/prepare-proot-android.sh`

The script verifies the complete Termux `.deb` files for PRoot, libtalloc, and
libandroid-shmem against pinned SHA-256 digests before copying the executable,
loader, and both required libraries into the Android build tree. The official
binaries remain byte-for-byte unchanged. At runtime XAgent copies
`libtalloc.so` inside its private code-cache directory under the SONAME
`libtalloc.so.2`, then resolves it through `LD_LIBRARY_PATH`. Generated
binaries are intentionally not checked into Git and never come from `xx/`.

Every Android GitHub Release includes a source archive generated directly from
that immutable commit, plus its SHA-256 checksum, beside the signed APK.
