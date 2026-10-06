import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("macOS CI preparation preserves healthy agents and bounds the Intel image workaround", () => {
  const script = fileURLToPath(new URL("../../../../scripts/release/prepare-macos-gui-smoke.py", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import importlib.util, pathlib, subprocess, sys, tempfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('preparation', sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as temp:
    environment = {'GITHUB_ACTIONS':'true', 'RUNNER_TEMP':temp}
    calls = []
    probe_count = 0
    scenario = 'healthy'
    def run(args, **options):
        global probe_count
        calls.append((args, options))
        assert 0 < options['timeout'] <= 120
        assert options['capture_output'] and options['text']
        if args[0] == 'xcrun' and scenario == 'compile-fails':
            return subprocess.CompletedProcess(args, 1, '', 'compiler failure')
        if len(args) == 1:
            probe_count += 1
            if scenario == 'unrecoverable' or scenario == 'recoverable' and probe_count == 1:
                raise subprocess.TimeoutExpired(args, options['timeout'])
        return subprocess.CompletedProcess(args, 0, 'ready', '')
    def prepare(**overrides):
        values = dict(environ=environment, system='Darwin', machine='x86_64', version='26.6.1', run=run, uid=501)
        values.update(overrides); module.prepare(**values)
    # This helper must never change a developer Mac, an ARM VM or another OS.
    for overrides in [dict(environ={'GITHUB_ACTIONS':'false'}), dict(machine='arm64'),
                      dict(version='15.7'), dict(system='Windows')]:
        prepare(**overrides)
    assert not calls and not list(pathlib.Path(temp).iterdir())
    prepare()
    assert len(calls) == 2 and all(args[0] != 'launchctl' for args, _ in calls)
    assert calls[-1][1]['timeout'] == 15
    calls.clear(); probe_count = 0; scenario = 'recoverable'; prepare()
    service = 'gui/501/com.apple.iconservices.iconservicesagent'
    assert [args for args, _ in calls if args[:1] == ['launchctl']] == [
        ['launchctl', 'print', service], ['launchctl', 'bootout', service], ['launchctl', 'disable', service]]
    assert probe_count == 2, 'A successful actual icon request is required after recovery'
    assert 'Timed out' in (pathlib.Path(temp) / 'xgent-macos-iconservices.log').read_text()
    for scenario in ['unrecoverable', 'compile-fails']:
        calls.clear(); probe_count = 0
        try: prepare()
        except RuntimeError: pass
        else: raise AssertionError('Unresolved preparation failures must stop the job')
        if scenario == 'compile-fails':
            assert len(calls) == 1, 'Compiler errors must not disable a healthy system service'
`, script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
