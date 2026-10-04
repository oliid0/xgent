import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("dash discovers every registered iOS command while preserving package scripts", () => {
  const script = fileURLToPath(new URL("../../../../scripts/mobile/prepare-ios-command-markers.py", import.meta.url));
  const registry = fileURLToPath(new URL("../../../mobile-execution/ios/Sources/Resources/commandDictionary.plist", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import importlib.util, pathlib, plistlib, sys, tempfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("markers", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
registry = pathlib.Path(sys.argv[2])
with registry.open('rb') as stream:
    commands = plistlib.load(stream)
with tempfile.TemporaryDirectory() as temporary:
    root = pathlib.Path(temporary)
    directory = root / 'bin'
    directory.mkdir()
    script = b'#!/bin/sh\nprintf real-package-command'
    (directory / 'pkg').write_bytes(script)
    extra = root / 'extra.plist'
    extra.write_bytes(plistlib.dumps({'pkg': ['shell', 'pkg']}))
    module.prepare_markers(directory, [registry, extra])
    for command in commands:
        assert (directory / command).is_file(), command
        assert (directory / command).read_bytes() == b'', command
    assert (directory / 'pkg').read_bytes() == script
    module.prepare_markers(directory, [registry, extra])
    assert (directory / 'pkg').read_bytes() == script
    assert (directory / 'jsc').stat().st_size == 0
    for name in ['../escape', '/absolute', 'bad\\name', 'bad:name', '.']:
        extra.write_bytes(plistlib.dumps({name: []}))
        target = root / 'invalid-bin'
        try:
            module.prepare_markers(target, [registry, extra])
            raise AssertionError('Unsafe registry accepted: ' + name)
        except ValueError:
            pass
        assert not target.exists(), 'Validate all names before writing command markers'
    extra.write_bytes(plistlib.dumps(['not-a-command-dictionary']))
    try:
        module.prepare_markers(directory, [extra])
        raise AssertionError('Non-dictionary accepted')
    except ValueError:
        pass
`, script, registry], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("native iOS execution does not search the simulator host for shell commands", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  const plugin = read("../../../mobile-execution/ios/Sources/MobileExecutionPlugin.swift");
  const environment = plugin.slice(plugin.indexOf("private func configureCommandEnvironment"), plugin.indexOf("private func isCancelled"));
  assert.doesNotMatch(environment, /applicationBin\).*:\/usr\/bin|applicationBin\).*:\/bin/);
  assert.match(environment, /documentsBin\):\\\(applicationBin\)"/);
  assert.match(plugin, /installationVerificationVersion = "ios-a-shell-v6"/);
  assert.match(plugin, /Missing native a-Shell command marker/);
  const prepare = read("../../../../scripts/mobile/prepare-ios-shell-resources.sh");
  assert.match(prepare, /prepare-ios-command-markers\.py/);
  assert.match(prepare, /\$OUTPUT_ROOT\/commandDictionary\.plist.*\$OUTPUT_ROOT\/extraCommandsDictionary\.plist/);
});

test("native iOS command cancellation cannot send process-fatal signals to its embedded interpreter", () => {
  const plugin = readFileSync(new URL("../../../mobile-execution/ios/Sources/MobileExecutionPlugin.swift", import.meta.url), "utf8");
  assert.doesNotMatch(plugin, /ios_killpid\s*\(/, "ios_killpid uses pthread_kill, which must not receive an application-fatal signal");
  assert.doesNotMatch(plugin, /pthread_kill\s*\(/);
  const smoke = readFileSync(new URL("../../../../scripts/release/ios-ui-smoke/Tests/ShellInstallationTests.swift", import.meta.url), "utf8");
  assert.match(smoke, /xgent-ios-after-cancel-ok/);
  assert.match(smoke, /identifier ENDSWITH ':cancelled'/);
});
