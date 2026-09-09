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


def load_commands(data):
    if data[:4] in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        wide = data[:4] == b"\xca\xfe\xba\xbf"
        count = struct.unpack_from(">I", data, 4)[0]
        for index in range(count):
            offset = 8 + index * (32 if wide else 20)
            cpu = struct.unpack_from(">I", data, offset)[0]
            start, size = struct.unpack_from(">QQ" if wide else ">II", data, offset + 8)
            if cpu == ARM64:
                return load_commands(data[start:start + size])
        raise ValueError("Universal binary has no arm64 slice")
    if len(data) < 32 or data[:4] != b"\xcf\xfa\xed\xfe":
        raise ValueError("Expected a 64-bit little-endian Mach-O binary")
    _, cpu, _, _, count, size, _, _ = struct.unpack_from("<8I", data)
    if cpu != ARM64 or 32 + size > len(data):
        raise ValueError("Missing arm64 architecture or truncated load commands")
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

        def expand(value, loader):
            return posixpath.normpath(value.replace("@executable_path", root.rstrip("/"))
                                      .replace("@loader_path", posixpath.dirname(loader)))

        app_rpaths = [expand(value, executable) for value in commands[executable][1]]
        errors = []
        for binary, (dependencies, rpaths) in commands.items():
            search_paths = app_rpaths + [expand(value, binary) for value in rpaths]
            for dependency, weak in dependencies:
                if dependency.startswith(("/usr/lib/", "/System/Library/")):
                    continue
                # iOS 12.2+ supplies the ABI-stable Swift core in the dyld cache.
                # Back-deployment libraries (e.g. Concurrency) still need embedding.
                if dependency == "@rpath/libswiftCore.dylib" and minimum_ios >= (12, 2):
                    continue
                candidates = [expand(dependency, binary)]
                if dependency.startswith("@rpath/"):
                    candidates = [posixpath.normpath(base + "/" + dependency[7:]) for base in search_paths]
                if not weak and not any(candidate in binaries for candidate in candidates):
                    errors.append(f"{binary}: missing {dependency}")
        if errors:
            raise ValueError("\n".join(sorted(errors)))
        return len(binaries)


if __name__ == "__main__":
    try:
        print(f"Verified arm64 dependencies for {inspect_ipa(sys.argv[1])} IPA binaries")
    except (ValueError, KeyError, struct.error, zipfile.BadZipFile) as error:
        raise SystemExit(str(error)) from error
