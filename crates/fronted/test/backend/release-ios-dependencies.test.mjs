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
print('device dependency graph cases passed')
`, fileURLToPath(new URL("../../../../scripts/release/inspect-ios-dependencies.py", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
