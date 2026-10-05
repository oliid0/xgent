import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("embed-only runtime staging verifies archives and keeps both platform slices", () => {
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import hashlib, importlib.util, io, pathlib, plistlib, stat, sys, tempfile, zipfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("runtime", sys.argv[1])
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
pins = runtime.catalog(sys.argv[2])
assert list(pins) == list(runtime.NAMES)
assert all(url.startswith('https://github.com/holzschu/ios_system/releases/download/Auxiliary/')
           and len(checksum) == 64 for url, checksum in pins.values())

def archive(simulator=True, unsafe=False, symlink=False):
    data = io.BytesIO()
    libraries = [{'LibraryIdentifier': 'ios-arm64', 'LibraryPath': 'dash.framework',
                  'SupportedPlatform': 'ios', 'SupportedArchitectures': ['arm64']}]
    if simulator:
        libraries.append({'LibraryIdentifier': 'ios-x86_64-simulator', 'LibraryPath': 'dash.framework',
                          'SupportedPlatform': 'ios', 'SupportedPlatformVariant': 'simulator',
                          'SupportedArchitectures': ['x86_64']})
    with zipfile.ZipFile(data, 'w') as z:
        z.writestr('dash.xcframework/Info.plist', plistlib.dumps({'AvailableLibraries': libraries}))
        for library in libraries:
            z.writestr('dash.xcframework/' + library['LibraryIdentifier'] + '/dash.framework/dash', b'verified fixture')
        if unsafe:
            z.writestr('dash.xcframework/../../escaped', b'outside')
        if symlink:
            entry = zipfile.ZipInfo('dash.xcframework/link')
            entry.create_system = 3
            entry.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(entry, '../outside')
    return data.getvalue()

with tempfile.TemporaryDirectory(prefix='xgent-runtime-test-') as temp:
    root = pathlib.Path(temp).resolve()
    output = root / 'Frameworks'
    output.mkdir()
    unrelated = output / 'python3_ios.xcframework'
    unrelated.mkdir()
    (unrelated / 'keep').write_text('unrelated runtime')
    payload = archive()
    checksum = hashlib.sha256(payload).hexdigest()
    staged = runtime.stage_archive(payload, checksum, 'dash', output)
    device = staged / 'ios-arm64/dash.framework/dash'
    simulator = staged / 'ios-x86_64-simulator/dash.framework/dash'
    assert device.read_bytes() == simulator.read_bytes() == b'verified fixture'
    device.chmod(stat.S_IRUSR)
    runtime.stage_archive(payload, checksum, 'dash', output)
    assert device.read_bytes() == b'verified fixture'
    assert (unrelated / 'keep').read_text() == 'unrelated runtime'
    for bad, digest, expected in [(payload, '0' * 64, 'checksum'),
                                  (archive(False), None, 'device and simulator'),
                                  (archive(unsafe=True), None, 'Unsafe'),
                                  (archive(symlink=True), None, 'Unsafe')]:
        try:
            runtime.stage_archive(bad, digest or hashlib.sha256(bad).hexdigest(), 'dash', root / 'rejected')
            raise AssertionError('Invalid runtime archive was accepted')
        except ValueError as error:
            assert expected in str(error), str(error)
        assert not (root / 'rejected').exists()
        assert not (root / 'escaped').exists()
`, fileURLToPath(new URL("../../../../scripts/mobile/prepare-ios-runtime-frameworks.py", import.meta.url)),
    fileURLToPath(new URL("../../../mobile-execution/ios-frameworks/Package.swift", import.meta.url))],
  { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
