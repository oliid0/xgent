#!/usr/bin/env bash
set -euo pipefail

# Build Xgent's in-process native driver. No package manager, network source,
# external MCP server or separate app identity is involved.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
arch="${1:?Expected arm64 or x86_64}"
case "$arch" in arm64|x86_64) ;; *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; esac
sources="$repo_root/crates/fronted/src-tauri/native/computer-use/macos"
output="$repo_root/crates/fronted/src-tauri/resources/cua/libXgentComputerUse.dylib"
mkdir -p "$(dirname "$output")"
xcrun swiftc -swift-version 5 -O -emit-library -module-name XgentComputerUse \
  -target "$arch-apple-macosx14.0" \
  -Xlinker -install_name -Xlinker '@rpath/libXgentComputerUse.dylib' \
  "$sources"/*.swift -o "$output"
identity="${APPLE_SIGNING_IDENTITY:--}"
if [ "${SIGNED_RELEASE:-false}" != true ]; then identity=-; fi
codesign --force --sign "$identity" --options runtime "$output"
codesign --verify --strict "$output"
target_arch="$arch"
if [ "$arch" = arm64 ]; then target_arch=aarch64; fi
cd "$repo_root"
node scripts/release/stage-computer-use.mjs "$output" "macos-$target_arch" "${XGENT_RELEASE_TAG:?Missing release tag}"
