#!/usr/bin/env python3
"""Check the actual arm64 IPA dependency graph without loading untrusted code.

Load command layouts: Apple's EXTERNAL_HEADERS/mach-o/loader.h and fat.h.
This complements simulator launch checks, whose library slices can differ.
"""
import plistlib
import posixpath
import struct
import sys
import zipfile

ARM64 = 0x0100000C
LC_RPATH = 0x8000001C
LC_LOAD_WEAK_DYLIB = 0x80000018
DYLIB_COMMANDS = {0xC, LC_LOAD_WEAK_DYLIB, 0x8000001F, 0x20, 0x80000023}


def arm64_slice(data):
    if data[:4] in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        wide = data[:4] == b"\xca\xfe\xba\xbf"
        count = struct.unpack_from(">I", data, 4)[0]
        for index in range(count):
            offset = 8 + index * (32 if wide else 20)
            cpu = struct.unpack_from(">I", data, offset)[0]
            start, size = struct.unpack_from(">QQ" if wide else ">II", data, offset + 8)
            if cpu == ARM64:
                if start + size > len(data):
                    raise ValueError("Truncated universal binary slice")
                return arm64_slice(data[start:start + size])
        raise ValueError("Universal binary has no arm64 slice")
    if len(data) < 32 or data[:4] != b"\xcf\xfa\xed\xfe":
        raise ValueError("Expected a 64-bit little-endian Mach-O binary")
    _, cpu, _, _, count, size, _, _ = struct.unpack_from("<8I", data)
    if cpu != ARM64 or 32 + size > len(data):
        raise ValueError("Missing arm64 architecture or truncated load commands")
    return data


def load_commands(data):
    data = arm64_slice(data)
    count, size = struct.unpack_from("<II", data, 16)
    dependencies, rpaths = [], []
    offset = 32
    for _ in range(count):
        if offset + 8 > 32 + size:
            raise ValueError("Truncated load command")
        command, length = struct.unpack_from("<II", data, offset)
        if length < 8 or offset + length > 32 + size:
            raise ValueError("Invalid load command size")
        if command in DYLIB_COMMANDS or command == LC_RPATH:
            if length < 12:
                raise ValueError("Truncated load command string offset")
            start = struct.unpack_from("<I", data, offset + 8)[0]
            if start < 12 or start >= length:
                raise ValueError("Invalid load command string offset")
            value = data[offset + start:offset + length].split(b"\0", 1)[0].decode("utf-8")
            if command == LC_RPATH:
                rpaths.append(value)
            else:
                dependencies.append((value, command == LC_LOAD_WEAK_DYLIB))
        offset += length
    return dependencies, rpaths


def symbol_table(data):
    """Read retained dynamic symbols using Apple's mach-o/nlist.h layout.

    Two-level imports identify their provider by load-command ordinal; finding
    a name in an unrelated framework does not satisfy that import.
    """
    data = arm64_slice(data)
    load_commands(data)  # Validate all command bounds before reading tables.
    count = struct.unpack_from("<I", data, 16)[0]
    offset = 32
    exports, imports = set(), []
    for _ in range(count):
        command, length = struct.unpack_from("<II", data, offset)
        if command == 2:  # LC_SYMTAB
            if length < 24:
                raise ValueError("Truncated symbol table command")
            symbols, total, strings, size = struct.unpack_from("<4I", data, offset + 8)
            if symbols + total * 16 > len(data) or strings + size > len(data):
                raise ValueError("Truncated symbol table")
            for index in range(total):
                start, kind, _, desc, value = struct.unpack_from("<IBBHQ", data, symbols + index * 16)
                if start >= size:
                    raise ValueError("Invalid symbol string offset")
                end = data.find(b"\0", strings + start, strings + size)
                if end < 0:
                    raise ValueError("Unterminated symbol name")
                name = data[strings + start:end].decode("utf-8")
                if not name or kind & 0xe0 or not kind & 1:
                    continue
                if kind & 0x0e in (2, 0x0e) and not kind & 0x10:
                    exports.add(name)
                elif kind & 0x0e == 0 and value == 0 and not desc & 0x40:
                    imports.append((name, desc >> 8))  # N_WEAK_REF is optional.
        offset += length
    return exports, imports


def inspect_ipa(path):
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        roots = [name[:-10] for name in names
                 if name.startswith("Payload/") and name.count("/") == 2
                 and name.endswith(".app/Info.plist")]
        if len(roots) != 1:
            raise ValueError("Expected one iOS app bundle")
        root = roots[0]
        info = plistlib.loads(archive.read(root + "Info.plist"))
        minimum_ios = tuple(int(part) for part in info.get("MinimumOSVersion", "0.0").split("."))
        executable = root + info["CFBundleExecutable"]
        binaries = {executable}
        for name in names:
            if name.startswith(root + "Frameworks/") and name.endswith(".framework/Info.plist"):
                framework = plistlib.loads(archive.read(name))
                binaries.add(posixpath.dirname(name) + "/" + framework["CFBundleExecutable"])
            elif name.startswith(root + "Frameworks/") and name.endswith(".dylib"):
                binaries.add(name)
        commands = {name: load_commands(archive.read(name)) for name in binaries}
        symbols = {name: symbol_table(archive.read(name)) for name in binaries}

        def expand(value, loader):
            return posixpath.normpath(value.replace("@executable_path", root.rstrip("/"))
                                      .replace("@loader_path", posixpath.dirname(loader)))

        app_rpaths = [expand(value, executable) for value in commands[executable][1]]
        errors = []
        resolved = {}
        for binary, (dependencies, rpaths) in commands.items():
            search_paths = app_rpaths + [expand(value, binary) for value in rpaths]
            for ordinal, (dependency, weak) in enumerate(dependencies, 1):
                if dependency.startswith(("/usr/lib/", "/System/Library/")):
                    continue
                candidates = [expand(dependency, binary)]
                if dependency.startswith("@rpath/"):
                    candidates = [posixpath.normpath(base + "/" + dependency[7:]) for base in search_paths]
                # ABI stability does not make @rpath resolution automatic. The
                # device crash in yy resolves only Frameworks and /usr/lib;
                # accepting Swift core without /usr/lib/swift hid that failure.
                if (minimum_ios >= (12, 2)
                        and "/usr/lib/swift/libswiftCore.dylib" in candidates):
                    continue
                if not weak and not any(candidate in binaries for candidate in candidates):
                    errors.append(f"{binary}: missing {dependency}")
                resolved[binary, ordinal] = next((candidate for candidate in candidates if candidate in binaries), None)
        # ios_system is the shared ABI used by separately released command
        # frameworks. The supplied device crash had all libraries present but
        # dash imported _ios_storeInteractive from an incompatible older core.
        # Scope this check to that ABI: system dyld caches and arbitrary export
        # re-export tries require platform tooling, not a guessed global lookup.
        for binary, (_, imports) in symbols.items():
            for symbol, ordinal in imports:
                provider = resolved.get((binary, ordinal))
                if provider and provider.endswith("/ios_system.framework/ios_system"):
                    if symbol not in symbols[provider][0]:
                        errors.append(f"{binary}: missing symbol {symbol} in {provider}")
        if errors:
            raise ValueError("\n".join(sorted(errors)))
        return len(binaries)


if __name__ == "__main__":
    try:
        print(f"Verified arm64 dependencies for {inspect_ipa(sys.argv[1])} IPA binaries")
    except (ValueError, KeyError, struct.error, zipfile.BadZipFile) as error:
        raise SystemExit(str(error)) from error
