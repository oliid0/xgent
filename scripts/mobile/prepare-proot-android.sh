#!/usr/bin/env bash
set -euo pipefail

readonly PROOT_SOURCE_REPOSITORY="https://github.com/termux/proot.git"
readonly TERMUX_PACKAGE_REPOSITORY="https://packages.termux.dev/apt/termux-main"
readonly TERMUX_PROOT_RECIPE="https://raw.githubusercontent.com/termux/termux-packages/master/packages/proot/build.sh"
readonly TALLOC_VERSION="2.4.4"
readonly TALLOC_ARCHIVE_URL="https://www.samba.org/ftp/talloc/talloc-${TALLOC_VERSION}.tar.gz"
readonly TALLOC_ARCHIVE_SHA256="55e47994018c13743485544e7206780ffbb3c8495e704a99636503e6e77abf59"
readonly SHMEM_VERSION="0.7"
readonly SHMEM_ARCHIVE_URL="https://github.com/termux/libandroid-shmem/archive/refs/tags/v${SHMEM_VERSION}.tar.gz"
readonly SHMEM_ARCHIVE_SHA256="1e5ff8459bc0a8c229dd8a94b27d119987e09ef3414331c2b5ebfff20b98e867"
readonly ANDROID_API="26"
readonly OUTPUT_ROOT="${1:-crates/mobile-execution/android/src/main/jniLibs}"
readonly MANIFEST_PATH="${2:-crates/mobile-execution/android/src/main/assets/xagent-proot-manifest.json}"

case "$OUTPUT_ROOT" in
  ""|"/"|".")
    echo "Refusing unsafe Android PRoot output path: $OUTPUT_ROOT" >&2
    exit 1
    ;;
esac

readonly TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

package_record() {
  local termux_arch="$1"
  local package_name="$2"
  local index="$TEMP_ROOT/Packages-$termux_arch.xz"
  if [ ! -f "$index" ]; then
    curl --fail --location --proto '=https' --tlsv1.2 \
      "$TERMUX_PACKAGE_REPOSITORY/dists/stable/main/binary-$termux_arch/Packages.xz" \
      --output "$index"
  fi
  python3 - "$index" "$package_name" <<'PY'
import lzma
import sys

index_path, wanted = sys.argv[1:]
with lzma.open(index_path, "rt", encoding="utf-8", errors="strict") as stream:
    paragraphs = stream.read().split("\n\n")
for paragraph in paragraphs:
    fields = {}
    for line in paragraph.splitlines():
        if ": " in line:
            key, value = line.split(": ", 1)
            fields[key] = value
    if fields.get("Package") == wanted:
        required = ("Version", "Filename", "SHA256")
        if not all(fields.get(key) for key in required):
            raise SystemExit(f"Incomplete metadata for {wanted}")
        print("\t".join(fields[key] for key in required))
        raise SystemExit(0)
raise SystemExit(f"Package {wanted} was not found for this architecture")
PY
}

extract_official_package() {
  local termux_arch="$1"
  local package_name="$2"
  local destination="$3"
  local record version filename sha256 archive member payload
  record="$(package_record "$termux_arch" "$package_name")"
  IFS=$'\t' read -r version filename sha256 <<<"$record"
  archive="$TEMP_ROOT/${termux_arch}-${package_name}.deb"
  curl --fail --location --proto '=https' --tlsv1.2 \
    "$TERMUX_PACKAGE_REPOSITORY/$filename" --output "$archive"
  echo "$sha256  $archive" | sha256sum --check --status
  member="$(ar t "$archive" | awk '/^data\.tar(\.|$)/ { print; exit }')"
  test -n "$member"
  payload="$TEMP_ROOT/${termux_arch}-${package_name}-${member}"
  ar p "$archive" "$member" > "$payload"
  mkdir -p "$destination"
  tar -xf "$payload" -C "$destination"
  printf '%s' "$version"
}

install_official_abi() {
  local android_abi="$1"
  local termux_arch="$2"
  local package_root="$TEMP_ROOT/official-$termux_arch"
  local prefix="$package_root/data/data/com.termux/files/usr"
  local proot_version proot_binary proot_loader talloc_library shmem_library
  proot_version="$(extract_official_package "$termux_arch" proot "$package_root")"
  extract_official_package "$termux_arch" libtalloc "$package_root" >/dev/null
  extract_official_package "$termux_arch" libandroid-shmem "$package_root" >/dev/null
  proot_binary="$prefix/bin/proot"
  proot_loader="$prefix/libexec/proot/loader"
  talloc_library="$(find "$prefix/lib" -maxdepth 1 -type f -name 'libtalloc.so*' | sort | head -n 1)"
  shmem_library="$(find "$prefix/lib" -maxdepth 1 -type f -name 'libandroid-shmem.so*' | sort | head -n 1)"
  test -f "$proot_binary"
  test -f "$proot_loader"
  test -f "$talloc_library"
  test -f "$shmem_library"
  install -Dm755 "$proot_binary" "$OUTPUT_ROOT/$android_abi/libxagent_proot.so"
  install -Dm755 "$proot_loader" "$OUTPUT_ROOT/$android_abi/libxagent_proot_loader.so"
  install -Dm755 "$talloc_library" "$OUTPUT_ROOT/$android_abi/libtalloc.so"
  install -Dm755 "$shmem_library" "$OUTPUT_ROOT/$android_abi/libandroid-shmem.so"
  printf '%s' "$proot_version"
}

prepare_official_packages() {
  local arm_version x86_version
  arm_version="$(install_official_abi arm64-v8a aarch64)"
  x86_version="$(install_official_abi x86_64 x86_64)"
  if [ "$arm_version" != "$x86_version" ]; then
    echo "Official PRoot versions differ between architectures" >&2
    return 1
  fi
  mkdir -p "$(dirname "$MANIFEST_PATH")"
  python3 - "$MANIFEST_PATH" "$arm_version" <<'PY'
import json
import sys

path, version = sys.argv[1:]
with open(path, "w", encoding="utf-8", newline="\n") as stream:
    json.dump(
        {
            "source": "termux-official-packages",
            "version": version,
            "repository": "https://packages.termux.dev/apt/termux-main",
            "architectures": ["arm64-v8a", "x86_64"],
        },
        stream,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    stream.write("\n")
PY
  echo "Prepared official Termux PRoot $arm_version in $OUTPUT_ROOT"
}

for command_name in curl tar sha256sum python3 ar awk install find; do
  command -v "$command_name" >/dev/null || {
    echo "$command_name is required to prepare Android PRoot" >&2
    exit 1
  }
done

set +e
(
  set -e
  prepare_official_packages
)
official_status=$?
set -e
if [ "$official_status" -eq 0 ]; then
  exit 0
fi

echo "Official PRoot packages were unavailable; falling back to an NDK source build" >&2
rm -f -- \
  "$OUTPUT_ROOT/arm64-v8a/libxagent_proot.so" \
  "$OUTPUT_ROOT/arm64-v8a/libxagent_proot_loader.so" \
  "$OUTPUT_ROOT/arm64-v8a/libtalloc.so" \
  "$OUTPUT_ROOT/arm64-v8a/libandroid-shmem.so" \
  "$OUTPUT_ROOT/x86_64/libxagent_proot.so" \
  "$OUTPUT_ROOT/x86_64/libxagent_proot_loader.so" \
  "$OUTPUT_ROOT/x86_64/libtalloc.so" \
  "$OUTPUT_ROOT/x86_64/libandroid-shmem.so"

for command_name in git make; do
  command -v "$command_name" >/dev/null || {
    echo "$command_name is required to build Android PRoot" >&2
    exit 1
  }
done

resolve_source_version() {
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$TERMUX_PROOT_RECIPE" |
    awk -F= '/^TERMUX_PKG_VERSION=/ { gsub(/["'"'[:space:]]/, "", $2); print $2; exit }'
}

readonly PROOT_SOURCE_VERSION="${PROOT_SOURCE_VERSION:-$(resolve_source_version)}"
test -n "$PROOT_SOURCE_VERSION"
readonly PROOT_SOURCE_TAG="v$PROOT_SOURCE_VERSION"
readonly PROOT_BUILD_VERSION="termux-$PROOT_SOURCE_VERSION"

if [ -z "${ANDROID_NDK_HOME:-}" ] || [ ! -d "$ANDROID_NDK_HOME" ]; then
  echo "ANDROID_NDK_HOME must point to an installed Android NDK" >&2
  exit 1
fi

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) readonly NDK_HOST_TAG="linux-x86_64" ;;
  Darwin-x86_64|Darwin-arm64) readonly NDK_HOST_TAG="darwin-x86_64" ;;
  *)
    echo "Unsupported Android PRoot build host: $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac
readonly TOOLCHAIN_BIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$NDK_HOST_TAG/bin"
test -d "$TOOLCHAIN_BIN"

fetch_verified_archive() {
  local url="$1"
  local sha256="$2"
  local output="$3"
  curl --fail --location --proto '=https' --tlsv1.2 "$url" --output "$output"
  echo "$sha256  $output" | sha256sum --check --status || {
    echo "Source archive SHA-256 mismatch: $url" >&2
    exit 1
  }
}

fetch_proot_source() {
  local source_dir="$TEMP_ROOT/proot-upstream"
  local source_ref="${PROOT_SOURCE_COMMIT:-$PROOT_SOURCE_TAG}"
  git init --quiet "$source_dir"
  git -C "$source_dir" remote add origin "$PROOT_SOURCE_REPOSITORY"
  git -C "$source_dir" fetch --quiet --depth=1 origin "$source_ref"
  git -C "$source_dir" checkout --quiet --detach FETCH_HEAD
  PROOT_RESOLVED_COMMIT="$(git -C "$source_dir" rev-parse HEAD)"
  if [ -n "${PROOT_SOURCE_COMMIT:-}" ] && [ "$PROOT_RESOLVED_COMMIT" != "$PROOT_SOURCE_COMMIT" ]; then
    echo "Official PRoot checkout resolved to unexpected commit: $PROOT_RESOLVED_COMMIT" >&2
    exit 1
  fi
}

prepare_dependency_sources() {
  local talloc_archive="$TEMP_ROOT/talloc.tar.gz"
  local shmem_archive="$TEMP_ROOT/libandroid-shmem.tar.gz"
  fetch_verified_archive "$TALLOC_ARCHIVE_URL" "$TALLOC_ARCHIVE_SHA256" "$talloc_archive"
  fetch_verified_archive "$SHMEM_ARCHIVE_URL" "$SHMEM_ARCHIVE_SHA256" "$shmem_archive"
  mkdir -p "$TEMP_ROOT/dependencies"
  tar -xzf "$talloc_archive" -C "$TEMP_ROOT/dependencies"
  tar -xzf "$shmem_archive" -C "$TEMP_ROOT/dependencies"
  test -f "$TEMP_ROOT/dependencies/talloc-${TALLOC_VERSION}/talloc.c"
  test -f "$TEMP_ROOT/dependencies/libandroid-shmem-${SHMEM_VERSION}/shmem.c"
}

build_abi() {
  local android_abi="$1"
  local ndk_triple="$2"
  local expected_arch="$3"
  local build_root="$TEMP_ROOT/build-$android_abi"
  local source_root="$build_root/proot"
  local dependency_root="$build_root/dependencies"
  local include_root="$build_root/include"
  local library_root="$build_root/lib"
  local cc="$TOOLCHAIN_BIN/${ndk_triple}${ANDROID_API}-clang"
  local ar="$TOOLCHAIN_BIN/llvm-ar"
  local ranlib="$TOOLCHAIN_BIN/llvm-ranlib"
  local strip="$TOOLCHAIN_BIN/llvm-strip"
  local objcopy="$TOOLCHAIN_BIN/llvm-objcopy"
  local objdump="$TOOLCHAIN_BIN/llvm-objdump"
  local readelf="$TOOLCHAIN_BIN/llvm-readelf"

  for tool in "$cc" "$ar" "$ranlib" "$strip" "$objcopy" "$objdump" "$readelf"; do
    test -x "$tool" || {
      echo "Missing Android NDK tool: $tool" >&2
      exit 1
    }
  done

  mkdir -p "$build_root" "$dependency_root" "$include_root/sys" "$library_root"
  cp -a "$TEMP_ROOT/proot-upstream/." "$source_root"
  cp -a "$TEMP_ROOT/dependencies/talloc-${TALLOC_VERSION}" "$dependency_root/talloc"
  cp "$TEMP_ROOT/dependencies/libandroid-shmem-${SHMEM_VERSION}/shmem.c" "$dependency_root/"
  cp "$TEMP_ROOT/dependencies/libandroid-shmem-${SHMEM_VERSION}/shm.h" "$include_root/sys/shm.h"

  # Use talloc's own cross-compile configuration, following the official
  # Termux libtalloc package recipe. This keeps feature detection and replace
  # headers generated by upstream instead of maintaining an Android shim.
  cat > "$dependency_root/talloc/cross-answers.txt" <<'EOF'
Checking uname sysname type: "Linux"
Checking uname machine type: "dontcare"
Checking uname release type: "dontcare"
Checking uname version type: "dontcare"
Checking simple C program: OK
building library support: OK
Checking for large file support: OK
Checking for -D_FILE_OFFSET_BITS=64: OK
Checking for WORDS_BIGENDIAN: OK
Checking for C99 vsnprintf: OK
Checking for HAVE_SECURE_MKSTEMP: OK
rpath library support: OK
-Wl,--version-script support: FAIL
Checking correct behavior of strtoll: OK
Checking correct behavior of strptime: OK
Checking for HAVE_IFACE_GETIFADDRS: OK
Checking for HAVE_IFACE_IFCONF: OK
Checking for HAVE_IFACE_IFREQ: OK
Checking getconf LFS_CFLAGS: OK
Checking for large file support without additional flags: OK
Checking for working strptime: OK
Checking for HAVE_SHARED_MMAP: OK
Checking for HAVE_MREMAP: OK
Checking for HAVE_INCOHERENT_MMAP: OK
Checking getconf large file support flags work: OK
EOF
  (
    cd "$dependency_root/talloc"
    CC="$cc" \
    AR="$ar" \
    RANLIB="$ranlib" \
    CFLAGS="-fPIC -O2 -Wall" \
      ./configure \
        --prefix="$dependency_root/talloc-prefix" \
        --disable-rpath \
        --disable-python \
        --cross-compile \
        --cross-answers=cross-answers.txt
    make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
  )
  mapfile -t talloc_objects < <(
    find "$dependency_root/talloc/bin/default" -maxdepth 1 -type f -name 'talloc*.o' -print
  )
  if [ "${#talloc_objects[@]}" -eq 0 ]; then
    echo "talloc cross-build produced no static objects for $android_abi" >&2
    exit 1
  fi
  "$ar" rcs "$library_root/libtalloc.a" "${talloc_objects[@]}"
  "$ranlib" "$library_root/libtalloc.a"

  "$cc" -c "$dependency_root/shmem.c" \
    -o "$dependency_root/shmem.o" \
    -I"$include_root" \
    -fPIC -O2 -Wall -Wextra -std=c11
  "$ar" rcs "$library_root/libandroid-shmem.a" "$dependency_root/shmem.o"
  "$ranlib" "$library_root/libandroid-shmem.a"

  (
    cd "$source_root/src"
    make \
      CC="$cc" \
      LD="$cc" \
      AR="$ar" \
      STRIP="$strip" \
      OBJCOPY="$objcopy" \
      OBJDUMP="$objdump" \
      CPPFLAGS="-D_FILE_OFFSET_BITS=64 -D_GNU_SOURCE -I. -DARG_MAX=131072 -DVERSION=\\\"$PROOT_BUILD_VERSION\\\" -I$dependency_root/talloc -I$include_root" \
      CFLAGS="-O2 -Wall -Wextra -fPIE -DWITH_LIBANDROID_SHMEM" \
      LDFLAGS="-pie -Wl,-z,noexecstack -Wl,-z,max-page-size=16384 -L$library_root -Wl,-Bstatic -ltalloc -landroid-shmem -Wl,-Bdynamic -llog -landroid" \
      PROOT_WITH_LIBANDROID_SHMEM=true \
      -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
  )

  local built_binary="$source_root/src/proot"
  local built_loader="$source_root/src/loader/loader"
  test -f "$built_binary"
  test -f "$built_loader"
  "$strip" "$built_binary"
  "$strip" "$built_loader"
  "$objdump" -f "$built_binary" | grep -F "$expected_arch" >/dev/null || {
    echo "Built PRoot has the wrong architecture for $android_abi" >&2
    exit 1
  }
  if "$readelf" -d "$built_binary" | grep -Eq 'lib(talloc|android-shmem)'; then
    echo "Built PRoot unexpectedly depends on an unpackaged native library" >&2
    exit 1
  fi
  install -Dm755 "$built_binary" "$OUTPUT_ROOT/$android_abi/libxagent_proot.so"
  install -Dm755 "$built_loader" "$OUTPUT_ROOT/$android_abi/libxagent_proot_loader.so"
}

PROOT_RESOLVED_COMMIT=""
fetch_proot_source
prepare_dependency_sources
build_abi "arm64-v8a" "aarch64-linux-android" "aarch64"
build_abi "x86_64" "x86_64-linux-android" "i386:x86-64"

mkdir -p "$(dirname "$MANIFEST_PATH")"
python3 - "$MANIFEST_PATH" "$PROOT_SOURCE_VERSION" "$PROOT_RESOLVED_COMMIT" <<'PY'
import json
import sys

path, version, commit = sys.argv[1:]
with open(path, "w", encoding="utf-8", newline="\n") as stream:
    json.dump(
        {
            "source": "termux-proot-source-fallback",
            "version": version,
            "commit": commit,
            "repository": "https://github.com/termux/proot.git",
            "architectures": ["arm64-v8a", "x86_64"],
        },
        stream,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    stream.write("\n")
PY
echo "Built PRoot $PROOT_SOURCE_VERSION from official termux/proot commit $PROOT_RESOLVED_COMMIT in $OUTPUT_ROOT"
