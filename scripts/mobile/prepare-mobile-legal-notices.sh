#!/usr/bin/env bash
set -euo pipefail

readonly SOURCE_ROOT="crates/mobile-execution"
readonly LEGAL_SOURCE_REVISION="0c314a7b2f9c5b2808639cf6300f6492efc142cb"
readonly ANDROID_OUTPUT="${1:-${SOURCE_ROOT}/android/src/main/assets/mobile-execution/legal}"
readonly IOS_OUTPUT="${2:-${SOURCE_ROOT}/ios/Sources/Resources/Legal}"

# The audited notice sources were removed from the working tree. Preserve the
# release obligations without restoring those Markdown files to the repository.
if ! git cat-file -e "${LEGAL_SOURCE_REVISION}^{commit}"; then
  echo "Missing audited mobile notices commit ${LEGAL_SOURCE_REVISION}; fetch full history" >&2
  exit 1
fi
for source in THIRD_PARTY_NOTICES.md PROOT_SOURCE.md \
  LICENSES/GNU-GPL-3.0.txt LICENSES/OneTrueAwk.txt \
  LICENSES/PRoot-GPL-2.0.txt LICENSES/WasmKit-MIT.txt \
  LICENSES/a-shell-BSD-3-Clause.txt LICENSES/ios_system-BSD-3-Clause.txt \
  LICENSES/libandroid-shmem-BSD-3-Clause.txt LICENSES/libtalloc-LGPL-3.0.txt; do
  if ! git cat-file -e "${LEGAL_SOURCE_REVISION}:${SOURCE_ROOT}/${source}"; then
    echo "Missing audited mobile legal-notice blob: $source" >&2
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
  git show "${LEGAL_SOURCE_REVISION}:${SOURCE_ROOT}/THIRD_PARTY_NOTICES.md" > "$output/THIRD_PARTY_NOTICES.txt"
  git show "${LEGAL_SOURCE_REVISION}:${SOURCE_ROOT}/PROOT_SOURCE.md" > "$output/PROOT_SOURCE.txt"
  for license in GNU-GPL-3.0 OneTrueAwk PRoot-GPL-2.0 WasmKit-MIT \
    a-shell-BSD-3-Clause ios_system-BSD-3-Clause \
    libandroid-shmem-BSD-3-Clause libtalloc-LGPL-3.0; do
    git show "${LEGAL_SOURCE_REVISION}:${SOURCE_ROOT}/LICENSES/${license}.txt" > "$output/LICENSES/${license}.txt"
  done
}

install_legal_bundle "$ANDROID_OUTPUT"
install_legal_bundle "$IOS_OUTPUT"

echo "Prepared Android and iOS legal-notice resources"
