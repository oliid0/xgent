# PRoot corresponding source

The Android APK bundles PRoot as a separate executable invoked through
`ProcessBuilder`. XAgent itself remains MIT licensed; PRoot remains licensed
under GPL-2.0-or-later.

- Packaged source identity: `termux-a89b3732ec6a`
- Binary builder: XGent GitHub Actions, using the Android NDK
- Corresponding source commit: `a89b3732ec6ae1db674510f0843b2f3db54d0a2f`
- Official source: `https://github.com/termux/proot/tree/a89b3732ec6ae1db674510f0843b2f3db54d0a2f`
- Reproduction/inclusion script: `scripts/mobile/prepare-proot-android.sh`

The script checks out the immutable commit directly from the official
`termux/proot` repository and verifies the exact commit before compiling it for
each APK ABI. libtalloc 2.4.4 and libandroid-shmem 0.7 are built from their
official, SHA-256-pinned source archives and linked statically into the
standalone PRoot executable. The PRoot loader is bundled by the upstream build
system, so runtime availability no longer depends on a removable package
mirror or separately extracted dependency files. Generated binaries are
intentionally not checked into Git and never come from `xx/`.

Every Android GitHub Release includes a source archive generated directly from
that immutable commit, plus its SHA-256 checksum, beside the signed APK.
