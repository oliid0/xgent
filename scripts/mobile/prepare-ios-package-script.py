"""Adapt the pinned a-Shell pkg script to Xgent's sandbox paths.

Upstream Resources/bin/pkg assumes APPDIR contains no spaces. Xgent stores
its environment under Library/Application Support. ios_system's execv bridge
also serializes argv[0] without quotes, so quoting an absolute executable path
alone still fails. Resolve the same bundled command with a command-scoped PATH
and a bare registry name; all file arguments and package operations stay intact.
"""

import argparse
import hashlib
from pathlib import Path
import re


UPSTREAM_SHA256 = "7ce374ce7292eddeb20cfbc2c7408145ba79227e5837b7d9c76b40f728ed6a35"
COMMAND_PATH = re.compile(r"\$APPDIR/bin/([a-z]+)")


def adapt_package_script(source: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != UPSTREAM_SHA256:
        raise ValueError("The pinned a-Shell pkg script changed; review its path handling")
    script = source.decode("utf-8")
    return COMMAND_PATH.sub(r'PATH="$APPDIR/bin" \1', script).encode("utf-8")


def prepare_package_script(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Package script is not a regular file: {path}")
    updated = adapt_package_script(path.read_bytes())
    path.write_bytes(updated)
    path.chmod(0o755)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    prepare_package_script(args.path)
