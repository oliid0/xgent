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


def make_staged_bundle_writable(bundle):
    # SwiftPM preserves the checkout's read-only font/resource permissions.
    # Device and simulator builds reuse this staging directory; only staging
    # files may change, never the original checkout or SwiftPM product.
    paths = [bundle, *bundle.rglob("*")]
    if any(path.is_symlink() for path in paths):
        raise ValueError(f"Staged resource bundle contains a symbolic link: {bundle.name}")
    for path in paths:
        permissions = path.stat().st_mode | stat.S_IWUSR
        if path.is_dir():
            permissions |= stat.S_IXUSR
        path.chmod(permissions)


def copy_bundles(source, destination):
    bundles = sorted(path for path in source.iterdir() if path.suffix == ".bundle")
    if not bundles:
        raise ValueError("The production SwiftPM product has no resource bundles")
    destination.mkdir(parents=True, exist_ok=True)
    for bundle in bundles:
        target = destination / bundle.name
        if not bundle.is_dir() or bundle.is_symlink() or target.is_symlink():
            raise ValueError(f"Resource bundle must be a real directory: {bundle.name}")
        if target.exists():
            make_staged_bundle_writable(target)
        shutil.copytree(bundle, target, dirs_exist_ok=True)
        make_staged_bundle_writable(target)
        print(f"Native UI resource: {bundle.name}")


def patch_math_fonts(checkouts):
    package = next((path for path in checkouts.iterdir() if path.name.lower() == "swatex"), None)
    if package is None:
        raise ValueError("The pinned SwaTex checkout is missing")
    source = package / "Sources/SwaTexRender/KaTeXFontProvider.swift"
    text = source.read_text(encoding="utf-8")
    marker = "xgentMathFontURL"
    if marker in text:
        if text.count(marker) != 2 or "func xgentMathFontURL(_ name: String) -> URL?" not in text:
            raise ValueError("The math font compatibility patch is incomplete")
        return
    original = '''            let url = Bundle.module.url(
                forResource: name, withExtension: "ttf", subdirectory: "Fonts"),'''
    if text.count(original) != 1:
        raise ValueError("SwaTex font lookup changed; review its pinned source")
    text = text.replace(original, "            let url = xgentMathFontURL(name),")
    text += '''

private final class XgentMathFontBundleFinder {}

private func xgentMathFontURL(_ name: String) -> URL? {
    let own = Bundle(for: XgentMathFontBundleFinder.self)
    let roots = [Bundle.main.resourceURL, Bundle.main.bundleURL,
                 own.resourceURL, own.bundleURL, own.bundleURL.deletingLastPathComponent()]
    for root in roots.compactMap({ $0 }) {
        if let bundle = Bundle(url: root.appendingPathComponent("SwaTex_SwaTexRender.bundle")),
           let url = bundle.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts") {
            return url
        }
    }
    return nil
}
'''
    source.chmod(source.stat().st_mode | stat.S_IWUSR)
    source.write_text(text, encoding="utf-8")


def verify_files(files, keyboard):
    fonts = "SwaTex_SwaTexRender.bundle/"
    for name in ["KaTeX_Main-Regular.ttf", "KaTeX_Math-Italic.ttf", "KaTeX_Size4-Regular.ttf"]:
        if not any(path.startswith(fonts) and path.endswith("/Fonts/" + name) for path in files):
            raise ValueError(f"The packaged math font is missing: {name}")
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
    parser.add_argument("operation", choices=["patch-keyboard", "patch-math", "copy", "verify-macos", "verify-ios"])
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", nargs="?", type=Path)
    args = parser.parse_args()
    if args.operation == "patch-keyboard":
        patch_keyboard_shortcuts(args.source)
    elif args.operation == "patch-math":
        patch_math_fonts(args.source)
    elif args.operation == "copy":
        if args.destination is None:
            parser.error("copy requires the destination resource directory")
        copy_bundles(args.source, args.destination)
    else:
        verify(args.source, ios=args.operation == "verify-ios")


if __name__ == "__main__":
    main()
