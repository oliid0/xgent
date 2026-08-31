# PRoot corresponding source

The Android APK bundles PRoot as a separate executable invoked through
`ProcessBuilder`. Xgent itself remains MIT licensed; PRoot remains licensed
under GPL-2.0-or-later.

- Packaged source identity: recorded at build time in
  `xgent-proot-manifest.json`
- Primary binary source: the current `proot`, `libtalloc`, and
  `libandroid-shmem` packages from the official Termux stable package index
- Source fallback: the current version declared by the official Termux PRoot
  recipe, built by XGent GitHub Actions with the Android NDK
- Official source: `https://github.com/termux/proot`
- Reproduction/inclusion script: `scripts/mobile/prepare-proot-android.sh`

The script resolves the newest version and SHA-256 digest from Termux's signed
repository metadata for every APK ABI. It packages the official executable,
unbundled loader, and both required shared libraries together. Xgent points
`PROOT_LOADER` and `LD_LIBRARY_PATH` at its extracted native-library directory,
so no `/data/data/com.termux` runtime path is required. If the official package
index is unavailable, the script resolves the current upstream recipe version,
checks out that tag, and builds PRoot plus its loader from source. The fallback
dependencies remain SHA-256-pinned and are linked statically. Generated
binaries are intentionally not checked into Git and never come from `xx/`.

Every Android GitHub Release reads the generated manifest and includes the
matching upstream source archive plus its SHA-256 checksum beside the signed
APK.
