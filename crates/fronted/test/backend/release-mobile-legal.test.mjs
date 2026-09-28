import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const sourceRoot = "crates/mobile-execution";
const notices = ["THIRD_PARTY_NOTICES.md", "PROOT_SOURCE.md"];
const licenses = [
  "GNU-GPL-3.0.txt", "OneTrueAwk.txt", "PRoot-GPL-2.0.txt", "WasmKit-MIT.txt",
  "a-shell-BSD-3-Clause.txt", "ios_system-BSD-3-Clause.txt",
  "libandroid-shmem-BSD-3-Clause.txt", "libtalloc-LGPL-3.0.txt",
];

test("mobile release notice inputs survive Git ignores and package into both targets", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "xgent-legal-"));
  try {
    const inputs = [...notices, ...licenses.map((name) => `LICENSES/${name}`)];
    for (const name of inputs) {
      const relative = `${sourceRoot}/${name}`;
      const source = path.join(repoRoot, relative);
      assert.ok(readFileSync(source).length > 100, `missing or empty release input: ${relative}`);
      const ignored = spawnSync("git", ["check-ignore", "--no-index", "--quiet", relative], { cwd: repoRoot });
      assert.equal(ignored.status, 1, `${relative} must not be ignored`);
      const target = path.join(fixture, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    const script = "prepare-mobile-legal-notices.sh";
    copyFileSync(path.join(repoRoot, "scripts/mobile", script), path.join(fixture, script));
    const gitBash = path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe");
    const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
    // Run the actual release script twice to cover repeat resource preparation.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(bash, [script], { cwd: fixture, encoding: "utf8", timeout: 30_000 });
      assert.equal(result.status, 0, result.error?.message || result.stderr);
      for (const output of ["android/src/main/assets/mobile-execution/legal", "ios/Sources/Resources/Legal"]) {
        for (const name of inputs) {
          assert.deepEqual(readFileSync(path.join(fixture, sourceRoot, output, name)), readFileSync(path.join(repoRoot, sourceRoot, name)));
        }
        assert.equal(readdirSync(path.join(fixture, sourceRoot, output, "LICENSES")).length, licenses.length);
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
