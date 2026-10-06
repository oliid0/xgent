import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("../../../../scripts/mobile/prepare-ios-package-script.py", import.meta.url));
const fixture = fileURLToPath(new URL("../fixtures/ios/pkg.pinned.sh", import.meta.url));
const canonical = readFileSync(fixture, "utf8").replace(/\r\n/g, "\n");

test("the reviewed a-Shell package script scopes bundled command lookup without serializing a path in argv zero", () => {
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import importlib.util, pathlib, sys, tempfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('package_script', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
source = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').encode('utf-8')
updated = module.adapt_package_script(source)
assert b'PATH="$APPDIR/bin" ls -1 ~/Documents/.pkg/' in updated
assert b'PATH="$APPDIR/bin" sh ~/tmp/$packageName' in updated
assert b'PATH="$APPDIR/bin" rehash' in updated
commands = b'\n'.join(line for line in updated.splitlines() if not line.lstrip().startswith(b'#'))
assert b'$APPDIR/bin/' not in commands, 'The execv bridge cannot preserve a spaced executable path'
for data in [b'', source + b'\n', source.replace(b'list() {', b'changed() {')]:
    try:
        module.adapt_package_script(data)
        raise AssertionError('An unreviewed upstream script was accepted')
    except ValueError:
        pass
with tempfile.TemporaryDirectory() as temporary:
    target = pathlib.Path(temporary) / 'pkg'
    target.write_bytes(b'unknown package script')
    try:
        module.prepare_package_script(target)
        raise AssertionError('Unknown script was overwritten')
    except ValueError:
        pass
    assert target.read_bytes() == b'unknown package script'
sys.stdout.buffer.write(updated)
`, helper, fixture], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const restored = result.stdout.replace(/PATH="\$APPDIR\/bin" ([a-z]+)/g, "$$APPDIR/bin/$1");
  assert.equal(restored, canonical, "Every package operation and upstream argument remains intact");
  assert.equal(createHash("sha1").update(`blob ${Buffer.byteLength(canonical)}\0`).update(canonical).digest("hex"),
    "33b61d116be4083e1a4103473e83bfd3c9f5b3af", "The fixture is the actual pinned upstream Git blob");
});

test("actual pkg list works when both the environment and home paths contain spaces", () => {
  const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh";
  assert.ok(existsSync(shell), "A POSIX shell is required to exercise the package script");
  const root = mkdtempSync(path.join(tmpdir(), "xgent pkg paths "));
  try {
    const app = path.join(root, "Application Support", "mobile environment");
    const home = path.join(root, "home with spaces");
    const bin = path.join(app, "bin");
    const registry = path.join(home, "Documents", ".pkg");
    mkdirSync(bin, { recursive: true });
    mkdirSync(registry, { recursive: true });
    writeFileSync(path.join(registry, "first.pkg"), "");
    writeFileSync(path.join(registry, "second.pkg"), "");
    for (const name of ["ls", "cat"])
      writeFileSync(path.join(bin, name), `#!/bin/sh\nexec /bin/${name} "$@"\n`, { mode: 0o755 });
    const script = path.join(bin, "pkg");
    writeFileSync(script, canonical);
    const prepare = spawnSync(process.platform === "win32" ? "python" : "python3", [helper, script], { encoding: "utf8" });
    assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
    const posix = value => process.platform === "win32"
      ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
      : value;
    const env = { ...process.env, APPDIR: posix(app), HOME: posix(home), ENV: "", BASH_ENV: "" };
    const list = spawnSync(shell, [script.replaceAll("\\", "/"), "list"], { env, encoding: "utf8" });
    assert.equal(list.status, 0, list.stderr || list.stdout);
    assert.equal(list.stderr, "");
    assert.deepEqual(list.stdout.trim().split(/\r?\n/), ["first.pkg", "second.pkg"]);
    const usage = spawnSync(shell, [script.replaceAll("\\", "/")], { env, encoding: "utf8" });
    assert.equal(usage.status, 0, usage.stderr || usage.stdout);
    assert.equal(usage.stderr, "");
    assert.match(usage.stdout, /Usage: pkg/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
