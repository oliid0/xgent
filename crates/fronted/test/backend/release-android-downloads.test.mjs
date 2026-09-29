import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../../../scripts/mobile/prepare-proot-android.sh", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");
const downloader = source.match(/fetch_verified_archive\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(downloader, "verified source downloader must be present");
const checksum = createHash("sha256").update("verified archive").digest("hex");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const harness = [
  "set -euo pipefail",
  'scenario="$1"',
  'output="$(mktemp)"',
  'trap \'rm -f "$output"\' EXIT',
  "curl() {",
  '  local url="" destination=""',
  '  while [ "$#" -gt 0 ]; do',
  '    case "$1" in',
  '      https:*) url="$1" ;;',
  '      --output) shift; destination="$1" ;;',
  "    esac",
  "    shift",
  "  done",
  '  echo "attempt:$url"',
  '  if [ "$scenario" = mismatch ]; then',
  '    printf \'corrupt archive\' > "$destination"',
  "    return 0",
  "  fi",
  '  if [ "$url" = https://primary.example/archive ] || [ "$scenario" = unavailable ]; then',
  '    printf \'partial archive\' > "$destination"',
  "    return 28",
  "  fi",
  '  printf \'verified archive\' > "$destination"',
  "}",
].join("\n");

for (const [scenario, mirror, attempts, succeeds] of [
  ["fallback", "https://mirror.example/archive", 2, true],
  ["mismatch", "https://mirror.example/archive", 1, false],
  ["unavailable", "https://mirror.example/archive", 2, false],
  ["single-source", "", 1, false],
]) {
  test("Android source download: " + scenario + " preserves checksum enforcement", () => {
    const script = harness + "\n" + downloader
      + "\nfetch_verified_archive https://primary.example/archive " + checksum
      + ' "$output" "' + mirror + '"\n'
      + 'test "$(cat "$output")" = \'verified archive\'\n';
    const result = spawnSync(bash, ["-c", script, "download-test", scenario], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status === 0, succeeds, result.stderr);
    assert.equal(result.stdout.match(/attempt:/g)?.length, attempts, result.stdout);
    if (scenario === "mismatch") assert.match(result.stderr, /SHA-256 mismatch/);
    if (!succeeds && scenario !== "mismatch") {
      assert.match(result.stderr, /Source archive download failed/);
    }
  });
}
