#!/usr/bin/env bash
set -euo pipefail

# PRoot and its complete native dependency closure are downloaded from the
# official Termux package repository. Every .deb is version- and SHA-pinned;
# no file is copied from the local xx/ reference project.

readonly PROOT_VERSION="5.1.107.84"
readonly TERMUX_REPOSITORY="https://packages.termux.dev/apt/termux-main"
readonly OUTPUT_ROOT="${1:-crates/mobile-execution/android/src/main/jniLibs}"

if ! command -v ar >/dev/null || ! command -v tar >/dev/null || \
   ! command -v curl >/dev/null || ! command -v sha256sum >/dev/null; then
  echo "ar, tar, curl, and sha256sum are required to prepare Android PRoot binaries" >&2
  exit 1
fi

prepare_abi() {
  local android_abi="$1"
  local deb_arch="$2"
  local proot_sha="$3"
  local shmem_sha="$4"
  local talloc_sha="$5"
  local temp_dir="$6/$android_abi"
  mkdir -p "$temp_dir"

  fetch_and_extract \
    "pool/main/p/proot/proot_${PROOT_VERSION}_${deb_arch}.deb" \
    "$proot_sha" "$temp_dir/proot"
  fetch_and_extract \
    "pool/main/liba/libandroid-shmem/libandroid-shmem_0.7_${deb_arch}.deb" \
    "$shmem_sha" "$temp_dir/shmem"
  fetch_and_extract \
    "pool/main/libt/libtalloc/libtalloc_2.4.3_${deb_arch}.deb" \
    "$talloc_sha" "$temp_dir/talloc"

  local termux_prefix="data/data/com.termux/files/usr"
  local proot_path="$temp_dir/proot/$termux_prefix/bin/proot"
  local loader_path="$temp_dir/proot/$termux_prefix/libexec/proot/loader"
  local shmem_path="$temp_dir/shmem/$termux_prefix/lib/libandroid-shmem.so"
  local talloc_path="$temp_dir/talloc/$termux_prefix/lib/libtalloc.so.2.4.3"
  for required in "$proot_path" "$loader_path" "$shmem_path" "$talloc_path"; do
    if [ ! -f "$required" ]; then
      echo "Termux runtime package layout changed; missing $required" >&2
      exit 1
    fi
  done

  local abi_output="$OUTPUT_ROOT/$android_abi"
  install -Dm755 "$proot_path" "$abi_output/libxagent_proot.so"
  install -Dm755 "$loader_path" "$abi_output/libxagent_proot_loader.so"
  install -Dm755 "$shmem_path" "$abi_output/libandroid-shmem.so"
  install -Dm755 "$talloc_path" "$abi_output/libtalloc.so"
}

fetch_and_extract() {
  local repository_path="$1"
  local expected_sha="$2"
  local extract_dir="$3"
  local package_path="$extract_dir/package.deb"
  local data_member
  mkdir -p "$extract_dir"
  curl --fail --location --proto '=https' --tlsv1.2 \
    "$TERMUX_REPOSITORY/$repository_path" --output "$package_path"
  echo "$expected_sha  $package_path" | sha256sum --check --status || {
    echo "Termux package SHA-256 mismatch: $repository_path" >&2
    exit 1
  }
  data_member="$(ar t "$package_path" | grep -E '^data\.tar\.(xz|zst|gz)$' | head -n 1)"
  if [ -z "$data_member" ]; then
    echo "Termux package has no supported data archive: $repository_path" >&2
    exit 1
  fi
  ar p "$package_path" "$data_member" > "$extract_dir/$data_member"
  case "$data_member" in
    *.xz) tar -xJf "$extract_dir/$data_member" -C "$extract_dir" ;;
    *.zst) tar --zstd -xf "$extract_dir/$data_member" -C "$extract_dir" ;;
    *.gz) tar -xzf "$extract_dir/$data_member" -C "$extract_dir" ;;
  esac
}

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

prepare_abi \
  arm64-v8a \
  aarch64 \
  59ace3b02894a9b87348eb5ccf246ed52ec64465021839422a151d7128acfe97 \
  0da3a24d558b93c92bcf8d611e0826a99ff96e396b148e6cdf33b47c47c57ff6 \
  ac81ad623d74c209718b9f3acb2dd702cc8a88c431e820d212229910b4db29da \
  "$temp_dir"

prepare_abi \
  x86_64 \
  x86_64 \
  98f30502dcc3c455ed5562e7fe0b8c04619b2b08633b3701a7750a86c6287e5d \
  ffa9e4c87467b158b148d0ff92dda796aa038276c2075af3269cdcdb06f25797 \
  7ca2eaae2e53b28228a01301bc410b62845403d6317c25b8e0a7f40681de0628 \
  "$temp_dir"

echo "Prepared verified PRoot $PROOT_VERSION binaries in $OUTPUT_ROOT"
