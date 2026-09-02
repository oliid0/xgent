#!/usr/bin/env bash
set -euo pipefail

# Runtime data used by the separately linked a-Shell command frameworks.
# The source is pinned to a commit; the local a-shell/ reference tree is never read.
readonly ASHELL_COMMIT="0a0614464ec65a9480f4d44f95a85273a33a6dfa"
readonly ASHELL_REPOSITORY="https://github.com/holzschu/a-shell.git"
readonly OUTPUT_ROOT="${1:-crates/mobile-execution/ios/Sources/Resources}"
readonly PYTHON_FRAMEWORK_OUTPUT_ROOT="${2:-crates/mobile-execution/ios-frameworks/Frameworks}"
readonly PYTHON_ARCHIVE_URL="https://github.com/holzschu/a-shell/releases/download/cpython_05_22/pythonInstall.tar.gz"
readonly PYTHON_ARCHIVE_SHA256="603d621a7bb5bc196fbd9309448d8231246d83371196285483430eea7c3b1f65"

readonly PYTHON_FRAMEWORKS=(
  python3_ios
  python3_ios-_asyncio python3_ios-_bisect python3_ios-_blake2 python3_ios-_bz2
  python3_ios-_codecs_cn python3_ios-_codecs_hk python3_ios-_codecs_iso2022
  python3_ios-_codecs_jp python3_ios-_codecs_kr python3_ios-_codecs_tw
  python3_ios-_contextvars python3_ios-_crypt python3_ios-_csv python3_ios-_ctypes
  python3_ios-_datetime python3_ios-_dbm python3_ios-_decimal python3_ios-_elementtree
  python3_ios-_hashlib python3_ios-_heapq python3_ios-_json python3_ios-_lsprof
  python3_ios-_md5 python3_ios-_multibytecodec python3_ios-_multiprocessing
  python3_ios-_opcode python3_ios-_pickle python3_ios-_posixshmem
  python3_ios-_posixsubprocess python3_ios-_queue python3_ios-_random
  python3_ios-_sha1 python3_ios-_sha256 python3_ios-_sha3 python3_ios-_sha512
  python3_ios-_socket python3_ios-_sqlite3 python3_ios-_ssl python3_ios-_statistics
  python3_ios-_struct python3_ios-_zoneinfo python3_ios-array python3_ios-audioop
  python3_ios-binascii python3_ios-cmath python3_ios-fcntl python3_ios-grp
  python3_ios-math python3_ios-mmap python3_ios-parser python3_ios-pyexpat
  python3_ios-resource python3_ios-select python3_ios-syslog python3_ios-termios
  python3_ios-unicodedata python3_ios-zlib
)

if ! command -v git >/dev/null; then
  echo "git is required to prepare iOS shell resources" >&2
  exit 1
fi

case "$OUTPUT_ROOT" in
  ""|"/"|".")
    echo "Refusing unsafe iOS resource output path: $OUTPUT_ROOT" >&2
    exit 1
    ;;
esac
case "$PYTHON_FRAMEWORK_OUTPUT_ROOT" in
  ""|"/"|".")
    echo "Refusing unsafe Python framework output path: $PYTHON_FRAMEWORK_OUTPUT_ROOT" >&2
    exit 1
    ;;
esac

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
checkout="$temp_dir/a-shell"

git init --quiet "$checkout"
git -C "$checkout" remote add origin "$ASHELL_REPOSITORY"
git -C "$checkout" sparse-checkout init --no-cone
git -C "$checkout" sparse-checkout set --no-cone \
  'Resources/vim/' 'cacert.pem' 'terminfo/' \
  'Resources/bin/pkg' 'Resources/bin/rehash' \
  'Resources/bin/cat' 'Resources/bin/chmod' 'Resources/bin/curl' \
  'Resources/bin/grep' 'Resources/bin/ls' 'Resources/bin/rm' \
  'Resources/bin/sh' 'Resources/bin/wc'
git -C "$checkout" fetch --quiet --depth 1 --filter=blob:none origin "$ASHELL_COMMIT"
git -C "$checkout" checkout --quiet --detach FETCH_HEAD

actual_commit="$(git -C "$checkout" rev-parse HEAD)"
if [ "$actual_commit" != "$ASHELL_COMMIT" ]; then
  echo "Unexpected a-Shell commit: $actual_commit" >&2
  exit 1
fi
if [ ! -f "$checkout/Resources/vim/syntax/syntax.vim" ] || \
   [ ! -f "$checkout/cacert.pem" ] || \
   [ ! -s "$checkout/Resources/bin/pkg" ]; then
  echo "Pinned a-Shell resource layout changed" >&2
  exit 1
fi

mkdir -p "$OUTPUT_ROOT"
rm -rf -- "$OUTPUT_ROOT/vim" "$OUTPUT_ROOT/terminfo" "$OUTPUT_ROOT/bin"
rm -f -- "$OUTPUT_ROOT/cacert.pem"
cp -R "$checkout/Resources/vim" "$OUTPUT_ROOT/vim"
cp -R "$checkout/terminfo" "$OUTPUT_ROOT/terminfo"
cp "$checkout/cacert.pem" "$OUTPUT_ROOT/cacert.pem"
mkdir -p "$OUTPUT_ROOT/bin"
for command_name in pkg rehash cat chmod curl grep ls rm sh wc; do
  cp "$checkout/Resources/bin/$command_name" "$OUTPUT_ROOT/bin/$command_name"
done

python_archive="$temp_dir/pythonInstall.tar.gz"
python_extract="$temp_dir/python"
mkdir -p "$python_extract"
curl --fail --location --retry 3 --output "$python_archive" "$PYTHON_ARCHIVE_URL"
actual_python_sha256="$(shasum -a 256 "$python_archive" | awk '{print $1}')"
if [ "$actual_python_sha256" != "$PYTHON_ARCHIVE_SHA256" ]; then
  echo "Unexpected a-Shell CPython archive checksum: $actual_python_sha256" >&2
  exit 1
fi

python_archive_paths=("cpython/Library/lib/python3.9")
for framework in "${PYTHON_FRAMEWORKS[@]}"; do
  python_archive_paths+=("cpython/XcFrameworks/$framework.xcframework")
done
tar -xzf "$python_archive" -C "$python_extract" \
  --exclude='cpython/Library/lib/python3.9/site-packages' \
  --exclude='cpython/Library/lib/python3.9/test' \
  --exclude='cpython/Library/lib/python3.9/idlelib' \
  --exclude='cpython/Library/lib/python3.9/tkinter' \
  "${python_archive_paths[@]}"

# Keep package installation usable without carrying the release archive's
# unrelated Jupyter, scientific, and desktop-only site packages.
for package_path in \
  pip pip-22.0.3.dist-info \
  setuptools setuptools-60.9.1.dist-info \
  wheel wheel-0.37.1.dist-info; do
  tar -xzf "$python_archive" -C "$python_extract" \
    "cpython/Library/lib/python3.9/site-packages/$package_path"
done

rm -rf -- "$OUTPUT_ROOT/python" "$PYTHON_FRAMEWORK_OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT/python/lib" "$PYTHON_FRAMEWORK_OUTPUT_ROOT"
cp -R "$python_extract/cpython/Library/lib/python3.9" "$OUTPUT_ROOT/python/lib/python3.9"
for framework in "${PYTHON_FRAMEWORKS[@]}"; do
  source_framework="$python_extract/cpython/XcFrameworks/$framework.xcframework"
  if [ ! -s "$source_framework/Info.plist" ]; then
    echo "The a-Shell CPython archive is missing $framework.xcframework" >&2
    exit 1
  fi
  cp -R "$source_framework" "$PYTHON_FRAMEWORK_OUTPUT_ROOT/$framework.xcframework"
done
if [ ! -s "$OUTPUT_ROOT/python/lib/python3.9/os.py" ] || \
   [ ! -s "$OUTPUT_ROOT/python/lib/python3.9/site-packages/pip/__init__.py" ] || \
   [ ! -s "$PYTHON_FRAMEWORK_OUTPUT_ROOT/python3_ios.xcframework/Info.plist" ]; then
  echo "The staged a-Shell CPython runtime failed validation" >&2
  exit 1
fi

echo "Prepared iOS shell resources and verified CPython in $OUTPUT_ROOT"
