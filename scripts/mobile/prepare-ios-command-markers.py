"""Expose linked ios_system commands to dash's filesystem command lookup.

ios_system v3.0.4 deliberately treats an empty command file as a registry
entry, not a script (isRealCommand in ios_system.m). These files let dash
find the signed framework commands without consulting macOS simulator bins.
"""

import argparse
import plistlib
from pathlib import Path


def prepare_markers(directory: Path, dictionaries: list[Path]) -> None:
    commands = set()
    for dictionary in dictionaries:
        with dictionary.open("rb") as stream:
            registry = plistlib.load(stream)
        if not isinstance(registry, dict):
            raise ValueError(f"Command registry is not a dictionary: {dictionary}")
        for command in registry:
            if (not isinstance(command, str) or not command or
                    command.startswith(".") or any(c in command for c in "/\\:\0")):
                raise ValueError(f"Unsafe command name in {dictionary}: {command!r}")
            commands.add(command)

    directory.mkdir(parents=True, exist_ok=True)
    for command in sorted(commands):
        marker = directory / command
        if marker.is_symlink() or (marker.exists() and not marker.is_file()):
            raise ValueError(f"Command marker is not a regular file: {marker}")
        # Existing pkg and other upstream scripts keep their actual contents.
        if not marker.exists():
            marker.touch()
        marker.chmod(0o755)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("dictionaries", type=Path, nargs="+")
    args = parser.parse_args()
    prepare_markers(args.directory, args.dictionaries)
