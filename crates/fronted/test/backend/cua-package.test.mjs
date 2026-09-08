import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("desktop CUA staging embeds a verified offline component without losing version configuration", () => {
  const root = fileURLToPath(new URL("../../../..", import.meta.url));
  const temporary = mkdtempSync(path.join(tmpdir(), "xgent-cua-staging-"));
  try {
    const source = path.join(temporary, "component.dll");
    const configPath = path.join(temporary, "version.json");
    const destination = path.join(temporary, "assets");
    const binary = Buffer.from("native-fixture");
    writeFileSync(source, binary);
    writeFileSync(configPath, JSON.stringify({ version: "1.2.3", bundle: { resources: { "existing.txt": "existing.txt" } } }));
    const result = spawnSync(process.execPath, ["scripts/release/stage-computer-use.mjs", source, "windows-x86_64", "v1.2.3", destination], {
      cwd: root, env: { ...process.env, XGENT_TAURI_VERSION_CONFIG: configPath }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(config.version, "1.2.3");
    assert.equal(config.bundle.resources["existing.txt"], "existing.txt");
    const filename = "Xgent-CUA-abi1-windows-x86_64.dll";
    assert.ok(Object.values(config.bundle.resources).includes(`computer-use/${filename}`));
    const manifest = JSON.parse(readFileSync(path.join(destination, "Xgent-CUA-abi1-windows-x86_64.json"), "utf8"));
    assert.equal(manifest.revision, 2);
    assert.equal(manifest.sha256, createHash("sha256").update(binary).digest("hex"));
    assert.equal(manifest.bytes, binary.length);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
