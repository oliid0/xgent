import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("IPA verifier rejects missing transitive device frameworks, broken rpaths and invalid binaries", () => {
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import importlib.util, io, plistlib, struct, sys, zipfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("inspector", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def macho(dependencies=(), rpaths=()):
    commands = []
    for command, value in [*dependencies, *((module.LC_RPATH, path) for path in rpaths)]:
        text = value.encode() + b'\0'
        length = (24 + len(text) + 7) // 8 * 8
        commands.append(struct.pack('<6I', command, length, 24, 0, 0, 0) + text + bytes(length - 24 - len(text)))
    payload = b''.join(commands)
    return struct.pack('<8I', 0xfeedfacf, module.ARM64, 0, 2, len(commands), len(payload), 0, 0) + payload

def ipa(include_lua, valid_rpath=True, weak=False):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as z:
        z.writestr('Payload/Xgent.app/Info.plist', plistlib.dumps({'CFBundleExecutable': 'Xgent'}))
        z.writestr('Payload/Xgent.app/Xgent', macho([(12, '@rpath/vim.framework/vim')], ['@executable_path/Frameworks'] if valid_rpath else []))
        frameworks = {'vim': macho([(module.LC_LOAD_WEAK_DYLIB if weak else 12, '@rpath/lua_ios.framework/lua_ios')])}
        if include_lua: frameworks['lua_ios'] = macho([(12, '/usr/lib/libSystem.B.dylib')])
        for name, binary in frameworks.items():
            root = 'Payload/Xgent.app/Frameworks/' + name + '.framework/'
            z.writestr(root + 'Info.plist', plistlib.dumps({'CFBundleExecutable': name}))
            z.writestr(root + name, binary)
    data.seek(0)
    return data

assert module.inspect_ipa(ipa(True)) == 3
assert module.inspect_ipa(ipa(False, weak=True)) == 2

# iOS ABI stability is insufficient when @rpath cannot reach /usr/lib/swift.
def swift_ipa(system_rpath):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as z:
        z.writestr('Payload/Xgent.app/Info.plist', plistlib.dumps({'CFBundleExecutable': 'Xgent', 'MinimumOSVersion': '14.0'}))
        paths = ['@executable_path/Frameworks'] + (['/usr/lib/swift'] if system_rpath else [])
        z.writestr('Payload/Xgent.app/Xgent', macho([(12, '@rpath/libswift_Concurrency.dylib')], paths))
        z.writestr('Payload/Xgent.app/Frameworks/libswift_Concurrency.dylib', macho([(12, '@rpath/libswiftCore.dylib')]))
    data.seek(0)
    return data
assert module.inspect_ipa(swift_ipa(True)) == 2
try:
    module.inspect_ipa(swift_ipa(False))
    raise AssertionError('Broken Swift runtime search path was accepted')
except ValueError as error:
    assert 'libswiftCore.dylib' in str(error)

for archive, expected in [(ipa(False), 'lua_ios'), (ipa(True, valid_rpath=False), 'vim.framework')]:
    try:
        module.inspect_ipa(archive)
        raise AssertionError('Invalid archive was accepted')
    except ValueError as error:
        assert expected in str(error), str(error)
for binary in [b'not Mach-O', macho()[:20], macho([(12, '@rpath/missing')])[:-4]]:
    try:
        module.load_commands(binary)
        raise AssertionError('Invalid binary was accepted')
    except ValueError:
        pass
arm64 = macho()
fat = struct.pack('>7I', 0xcafebabe, 1, module.ARM64, 0, 28, len(arm64), 0) + arm64
assert module.load_commands(fat) == ([], [])

# The libraries may all exist while their two-level symbol ABI is incompatible.
def with_symbols(binary, entries):
    names = b'\0'
    records = b''
    for name, kind, desc in entries:
        records += struct.pack('<IBBHQ', len(names), kind, 1 if kind == 15 else 0, desc, 0)
        names += name.encode() + b'\0'
    count, size = struct.unpack_from('<II', binary, 16)
    start = len(binary) + 24
    header = bytearray(binary[:32])
    struct.pack_into('<II', header, 16, count + 1, size + 24)
    return bytes(header) + binary[32:] + struct.pack('<6I', 2, 24, start, len(entries), start + len(records), len(names)) + records + names

def symbol_ipa(exported, weak=False):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as z:
        z.writestr('Payload/Xgent.app/Info.plist', plistlib.dumps({'CFBundleExecutable': 'Xgent'}))
        z.writestr('Payload/Xgent.app/Xgent', macho([(12, '@rpath/dash.framework/dash')], ['@executable_path/Frameworks']))
        dash = with_symbols(macho([(12, '@rpath/ios_system.framework/ios_system')]), [('_ios_storeInteractive', 1, 0x100 | (0x40 if weak else 0))])
        core = with_symbols(macho(), [(name, 15, 0) for name in exported])
        for name, binary in [('dash', dash), ('ios_system', core)]:
            root = 'Payload/Xgent.app/Frameworks/' + name + '.framework/'
            z.writestr(root + 'Info.plist', plistlib.dumps({'CFBundleExecutable': name}))
            z.writestr(root + name, binary)
    data.seek(0)
    return data
assert module.inspect_ipa(symbol_ipa(['_ios_storeInteractive'])) == 3
assert module.inspect_ipa(symbol_ipa([], weak=True)) == 3
try:
    module.inspect_ipa(symbol_ipa(['_ios_stopInteractive']))
    raise AssertionError('Incompatible ios_system ABI was accepted')
except ValueError as error:
    assert '_ios_storeInteractive' in str(error) and 'dash.framework' in str(error)
print('device dependency graph cases passed')
`, fileURLToPath(new URL("../../../../scripts/release/inspect-ios-dependencies.py", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});


test("the app embedding manifest uses the same verified iOS binaries as the plugin", () => {
  const plugin = readFileSync(new URL("../../../mobile-execution/ios/Package.swift", import.meta.url), "utf8");
  const embedded = readFileSync(new URL("../../../mobile-execution/ios-frameworks/Package.swift", import.meta.url), "utf8");
  const binaries = source => [...source.matchAll(/name: "([^"]+)",\s*url: "([^"]+)",\s*checksum: "([^"]+)"/g)].map(([, name, url, checksum]) => [name, { url, checksum }]);
  const actual = new Map(binaries(embedded));
  for (const [name, expected] of binaries(plugin)) assert.deepEqual(actual.get(name), expected, name);
});
