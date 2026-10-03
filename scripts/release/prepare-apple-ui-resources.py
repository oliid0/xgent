"""Carry SwiftPM resources alongside the statically linked native UI."""
import argparse
from pathlib import Path
import shutil
import stat
import zipfile


def patch_keyboard_shortcuts(checkouts):
    package = next((path for path in checkouts.iterdir()
                    if path.name.lower() == "keyboardshortcuts"), None)
    if package is None:
        raise ValueError("The pinned KeyboardShortcuts checkout is missing")
    source = package / "Sources/KeyboardShortcuts/Utilities.swift"
    text = source.read_text(encoding="utf-8")
    marker = "xgentKeyboardShortcutResourceBundle"
    if marker in text:
        if text.count(marker) != 2 or "private var xgentKeyboardShortcutResourceBundle: Bundle" not in text:
            raise ValueError("The shortcut bundle compatibility patch is incomplete")
        return
    original = "NSLocalizedString(self, bundle: .module, comment: self)"
    if text.count(original) != 1:
        raise ValueError("KeyboardShortcuts resource lookup changed; review its pinned source")
    # SwiftPM's command-line Bundle.module accessor searches the .app root.
    # A signed macOS app carries resources inside Contents/Resources instead.
    text = text.replace(original,
                        "NSLocalizedString(self, bundle: xgentKeyboardShortcutResourceBundle, comment: self)")
    text += '''

// Xgent's static Tauri integration: prefer the sealed application resources.
private final class XgentKeyboardShortcutBundleFinder {}

private var xgentKeyboardShortcutResourceBundle: Bundle {
    let own = Bundle(for: XgentKeyboardShortcutBundleFinder.self)
    let roots = [Bundle.main.resourceURL, Bundle.main.bundleURL,
                 own.resourceURL, own.bundleURL, own.bundleURL.deletingLastPathComponent()]
    for root in roots.compactMap({ $0 }) {
        if let bundle = Bundle(url: root.appendingPathComponent("KeyboardShortcuts_KeyboardShortcuts.bundle")) {
            return bundle
        }
    }
    // The original SwiftPM build-directory fallback remains useful to SDK tests.
    return .module
}
'''
    source.chmod(source.stat().st_mode | stat.S_IWUSR)
    source.write_text(text, encoding="utf-8")


def copy_bundles(source, destination):
    bundles = sorted(path for path in source.iterdir() if path.suffix == ".bundle")
    if not bundles:
        raise ValueError("The production SwiftPM product has no resource bundles")
    destination.mkdir(parents=True, exist_ok=True)
    for bundle in bundles:
        target = destination / bundle.name
        if not bundle.is_dir() or bundle.is_symlink() or target.is_symlink():
            raise ValueError(f"Resource bundle must be a real directory: {bundle.name}")
        shutil.copytree(bundle, target, dirs_exist_ok=True)
        print(f"Native UI resource: {bundle.name}")


def verify_files(files, keyboard):
    shader = "SwiftTerm_SwiftTerm.bundle/"
    if not any(name.startswith(shader) and name.endswith((".metal", ".metallib")) for name in files):
        raise ValueError("The packaged terminal shader resource is missing")
    if keyboard:
        localization = "KeyboardShortcuts_KeyboardShortcuts.bundle/"
        if not any(name.startswith(localization) and ".lproj/" in name
                   and name.endswith(".strings") for name in files):
            raise ValueError("The packaged shortcut localization resource is missing")


def verify(source, ios):
    if ios and source.is_file():
        with zipfile.ZipFile(source) as archive:
            roots = {entry.filename.split("/", 2)[1] for entry in archive.infolist()
                     if entry.filename.startswith("Payload/") and len(entry.filename.split("/", 2)) == 3
                     and entry.filename.split("/", 2)[1].endswith(".app")}
            if len(roots) != 1:
                raise ValueError("The IPA must contain one main application")
            prefix = f"Payload/{next(iter(roots))}/"
            files = [entry.filename.removeprefix(prefix) for entry in archive.infolist()
                     if entry.filename.startswith(prefix) and entry.file_size > 0]
    else:
        files = [path.relative_to(source).as_posix() for path in source.rglob("*")
                 if path.is_file() and path.stat().st_size > 0]
    verify_files(files, keyboard=not ios)
    print("Packaged native UI resource verification passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["patch-keyboard", "copy", "verify-macos", "verify-ios"])
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", nargs="?", type=Path)
    args = parser.parse_args()
    if args.operation == "patch-keyboard":
        patch_keyboard_shortcuts(args.source)
    elif args.operation == "copy":
        if args.destination is None:
            parser.error("copy requires the destination resource directory")
        copy_bundles(args.source, args.destination)
    else:
        verify(args.source, ios=args.operation == "verify-ios")


if __name__ == "__main__":
    main()
