#!/usr/bin/env bash
set -euo pipefail

readonly SOURCE_ROOT="crates/mobile-execution"
readonly ANDROID_OUTPUT="${1:-${SOURCE_ROOT}/android/src/main/assets/mobile-execution/legal}"
readonly IOS_OUTPUT="${2:-${SOURCE_ROOT}/ios/Sources/Resources/Legal}"

for source in \
  "${SOURCE_ROOT}/THIRD_PARTY_NOTICES.md" \
  "${SOURCE_ROOT}/PROOT_SOURCE.md" \
  "${SOURCE_ROOT}/LICENSES"; do
  if [ ! -e "$source" ]; then
    echo "Missing mobile legal-notice source: $source" >&2
    exit 1
  fi
done

for output in "$ANDROID_OUTPUT" "$IOS_OUTPUT"; do
  case "$output" in
    ""|"/"|".")
      echo "Refusing unsafe legal-notice output path: $output" >&2
      exit 1
      ;;
  esac
done

install_legal_bundle() {
  local output="$1"
  rm -rf -- "$output"
  mkdir -p "$output/LICENSES"
  cp "${SOURCE_ROOT}/THIRD_PARTY_NOTICES.md" "$output/"
  cp "${SOURCE_ROOT}/PROOT_SOURCE.md" "$output/"
  cp "${SOURCE_ROOT}/LICENSES/"*.txt "$output/LICENSES/"
}

install_legal_bundle "$ANDROID_OUTPUT"
install_legal_bundle "$IOS_OUTPUT"

echo "Prepared Android and iOS legal-notice resources"
