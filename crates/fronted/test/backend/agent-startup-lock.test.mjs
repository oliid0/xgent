import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("startup packages retain registry checksums and resolve their existing lock dependencies without upgrading Tauri", () => {
  const lock = readFileSync(new URL("../../../../Cargo.lock", import.meta.url), "utf8");
  const packages = lock.split("[[package]]").slice(1).map(block => ({
    name: /^name = "([^"]+)"/m.exec(block)?.[1],
    version: /^version = "([^"]+)"/m.exec(block)?.[1],
    checksum: /^checksum = "([^"]+)"/m.exec(block)?.[1],
    dependencies: [...(/dependencies = \[([\s\S]*?)\]/.exec(block)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(m => m[1]),
  }));
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/agent-startup-registry.json", import.meta.url), "utf8"));
  for (const evidence of fixture.packages) {
    const matches = packages.filter(p => p.name === evidence.name);
    assert.equal(matches.length, 1);
    const actual = matches[0];
    assert.equal(actual.version, evidence.version);
    assert.equal(actual.checksum, evidence.checksum);
    assert.deepEqual(actual.dependencies.map(d => d.split(" ")[0]).sort(), Object.keys(evidence.requirements).sort());
    for (const reference of actual.dependencies) {
      const [name, version] = reference.split(" ");
      const resolutions = packages.filter(p => p.name === name && (!version || p.version === version));
      assert.equal(resolutions.length, 1, `${evidence.name}: ambiguous/missing dependency ${reference}`);
      const requirement = evidence.requirements[name].slice(1).split(".").map(Number);
      const resolved = resolutions[0].version.split(".").map(Number);
      assert.equal(resolved[0], requirement[0], reference);
      if (!requirement[0]) assert.equal(resolved[1], requirement[1], reference);
      const padded = [requirement[0], requirement[1] ?? 0, requirement[2] ?? 0];
      assert.ok(resolved[1] > padded[1] || (resolved[1] === padded[1] && resolved[2] >= padded[2]), reference);
    }
  }
  assert.equal(packages.find(p => p.name === "tauri").version, "2.11.5");
  assert.equal(packages.find(p => p.name === "tauri-plugin").version, "2.6.3");
  assert.equal(packages.find(p => p.name === "xgent").dependencies.filter(d => d === "tauri-plugin-autostart").length, 1);
  const manifest = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
  assert.match(manifest, /tauri-plugin-autostart = "=2\.5\.1"/);
});
