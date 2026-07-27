#!/usr/bin/env bash
set -euo pipefail

# Runtime data used by the separately linked a-Shell command frameworks.
# The source is pinned to a commit; the local a-shell/ reference tree is never read.
readonly ASHELL_COMMIT="0a0614464ec65a9480f4d44f95a85273a33a6dfa"
readonly ASHELL_REPOSITORY="https://github.com/holzschu/a-shell.git"
readonly OUTPUT_ROOT="${1:-crates/mobile-execution/ios/Sources/Resources}"

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

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
checkout="$temp_dir/a-shell"

git init --quiet "$checkout"
git -C "$checkout" remote add origin "$ASHELL_REPOSITORY"
git -C "$checkout" sparse-checkout init --no-cone
git -C "$checkout" sparse-checkout set --no-cone \
  'Resources/vim/' 'cacert.pem' 'terminfo/'
git -C "$checkout" fetch --quiet --depth 1 --filter=blob:none origin "$ASHELL_COMMIT"
git -C "$checkout" checkout --quiet --detach FETCH_HEAD

actual_commit="$(git -C "$checkout" rev-parse HEAD)"
if [ "$actual_commit" != "$ASHELL_COMMIT" ]; then
  echo "Unexpected a-Shell commit: $actual_commit" >&2
  exit 1
fi
if [ ! -f "$checkout/Resources/vim/syntax/syntax.vim" ] || [ ! -f "$checkout/cacert.pem" ]; then
  echo "Pinned a-Shell resource layout changed" >&2
  exit 1
fi

mkdir -p "$OUTPUT_ROOT"
rm -rf -- "$OUTPUT_ROOT/vim" "$OUTPUT_ROOT/terminfo"
rm -f -- "$OUTPUT_ROOT/cacert.pem"
cp -R "$checkout/Resources/vim" "$OUTPUT_ROOT/vim"
cp -R "$checkout/terminfo" "$OUTPUT_ROOT/terminfo"
cp "$checkout/cacert.pem" "$OUTPUT_ROOT/cacert.pem"

echo "Prepared iOS shell resources from a-Shell $ASHELL_COMMIT in $OUTPUT_ROOT"
