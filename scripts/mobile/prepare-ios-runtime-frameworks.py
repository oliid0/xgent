"""Stage checksum-pinned, embed-only interpreters for the Xcode application."""
import argparse
import hashlib
import io
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import stat
import tempfile
import urllib.request
import zipfile

NAMES = ("dash", "dashA", "dashB", "dashC", "dashD", "dashE")


def catalog(manifest):
    binaries = dict((name, (url, checksum)) for name, url, checksum in re.findall(
        r'name: "([^"]+)",\s*url: "([^"]+)",\s*checksum: "([0-9a-f]{64})"',
        Path(manifest).read_text(encoding="utf-8")))
    missing = set(NAMES) - binaries.keys()
    if missing:
        raise ValueError(f"Missing pinned interpreter binaries: {sorted(missing)}")
    return {name: binaries[name] for name in NAMES}


def stage_archive(payload, checksum, name, output):
    if name not in NAMES or hashlib.sha256(payload).hexdigest() != checksum:
        raise ValueError(f"Invalid interpreter archive checksum: {name}")
    bundle = f"{name}.xcframework"
    with tempfile.TemporaryDirectory(prefix="xgent-ios-runtime-") as scratch:
        root = Path(scratch).resolve()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            members = []
            for entry in archive.infolist():
                path = PurePosixPath(entry.filename)
                if path.parts and path.parts[0] == "__MACOSX":
                    continue
                if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                        or not path.parts or path.parts[0] != bundle
                        or stat.S_ISLNK(entry.external_attr >> 16)):
                    raise ValueError(f"Unsafe interpreter archive member: {entry.filename}")
                target = root.joinpath(*path.parts).resolve()
                if not target.is_relative_to(root):
                    raise ValueError(f"Interpreter archive escapes staging: {entry.filename}")
                members.append(entry)
            archive.extractall(root, members=members)
        source = root / bundle
        with (source / "Info.plist").open("rb") as stream:
            info = plistlib.load(stream)
        platforms = set()
        for library in info.get("AvailableLibraries", []):
            identifier = library.get("LibraryIdentifier", "")
            library_path = library.get("LibraryPath", "")
            binary = (source / identifier / library_path / name).resolve()
            if not binary.is_relative_to(source) or not binary.is_file() or binary.stat().st_size == 0:
                raise ValueError(f"Missing interpreter framework binary: {name}")
            if library.get("SupportedPlatform") == "ios":
                platforms.add(library.get("SupportedPlatformVariant", "device"))
        if not {"device", "simulator"}.issubset(platforms):
            raise ValueError(f"Interpreter must contain device and simulator slices: {name}")
        destination = Path(output).resolve() / bundle
        # Only generated output is writable; preserve the verified archive and
        # support repeated resource staging without deleting unrelated bundles.
        if destination.exists():
            for file in destination.rglob("*"):
                if file.is_file():
                    file.chmod(file.stat().st_mode | stat.S_IWUSR)
        shutil.copytree(source, destination, dirs_exist_ok=True)
        return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default="crates/mobile-execution/ios-frameworks/Package.swift")
    parser.add_argument("--output", default="crates/mobile-execution/ios-frameworks/Frameworks")
    args = parser.parse_args()
    for name, (url, checksum) in catalog(args.manifest).items():
        request = urllib.request.Request(url, headers={"User-Agent": "Xgent-iOS-runtime-staging"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
        destination = stage_archive(payload, checksum, name, args.output)
        print(f"Verified embed-only runtime: {destination}")


if __name__ == "__main__":
    main()
