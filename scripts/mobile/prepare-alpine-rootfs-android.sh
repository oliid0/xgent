#!/usr/bin/env bash
set -euo pipefail

# Download the official, version-pinned Alpine minirootfs archives and package
# them as signed APK assets. Android verifies the generated manifest again
# before activating the rootfs.

readonly ALPINE_VERSION="3.22.5"
readonly ALPINE_SERIES="v3.22"
readonly ALPINE_RELEASES="https://dl-cdn.alpinelinux.org/alpine/${ALPINE_SERIES}/releases"
readonly OUTPUT_ROOT="${1:-crates/mobile-execution/android/src/main/assets/mobile-execution/rootfs}"

if ! command -v curl >/dev/null || ! command -v sha256sum >/dev/null; then
  echo "curl and sha256sum are required to prepare Android Alpine assets" >&2
  exit 1
fi

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
mkdir -p "$OUTPUT_ROOT"

prepare_arch() {
  local android_abi="$1"
  local alpine_arch="$2"
  local filename="alpine-minirootfs-${ALPINE_VERSION}-${alpine_arch}.tar.gz"
  local base_url="${ALPINE_RELEASES}/${alpine_arch}"

  curl --fail --location --proto '=https' --tlsv1.2 \
    "${base_url}/${filename}" --output "${temp_dir}/${filename}"
  curl --fail --location --proto '=https' --tlsv1.2 \
    "${base_url}/${filename}.sha256" --output "${temp_dir}/${filename}.sha256"

  (
    cd "$temp_dir"
    sha256sum --check "${filename}.sha256"
  ) >&2

  install -Dm644 \
    "${temp_dir}/${filename}" \
    "${OUTPUT_ROOT}/alpine-${ALPINE_VERSION}-${android_abi}.tar.gz"
  sha256sum "${temp_dir}/${filename}" | awk '{print $1}'
}

arm64_sha="$(prepare_arch arm64-v8a aarch64)"
x86_64_sha="$(prepare_arch x86_64 x86_64)"

cat > "${OUTPUT_ROOT}/manifest.json" <<EOF
{
  "schemaVersion": 1,
  "distribution": "Alpine Linux",
  "version": "${ALPINE_VERSION}",
  "repositoryBranch": "${ALPINE_SERIES}",
  "archives": {
    "arm64-v8a": {
      "file": "alpine-${ALPINE_VERSION}-arm64-v8a.tar.gz",
      "sha256": "${arm64_sha}"
    },
    "x86_64": {
      "file": "alpine-${ALPINE_VERSION}-x86_64.tar.gz",
      "sha256": "${x86_64_sha}"
    }
  }
}
EOF

echo "Prepared verified Alpine ${ALPINE_VERSION} rootfs assets in ${OUTPUT_ROOT}"
