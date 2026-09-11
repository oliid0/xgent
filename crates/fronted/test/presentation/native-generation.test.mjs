import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateNativeComponents, runGeneration } from "../../../../scripts/generate-native-ui.mjs";

const registry = JSON.parse(readFileSync(new URL("../../presentation/astryx-swiftui.json", import.meta.url), "utf8"));

test("checked-in native declarations agree with the mapping and installed Astryx version", () => {
  runGeneration({ check: true });
  const generated = generateNativeComponents(registry);
  for (const entry of registry.components) {
    assert.ok(generated.swift.includes(`case .${entry.swiftCase}:`));
    assert.ok(generated.types.includes(`"${entry.kind}"`));
  }
});

test("the generator rejects ambiguous mappings instead of silently rendering the wrong control", () => {
  assert.throws(() => generateNativeComponents(null), /mapping/);
  assert.throws(() => generateNativeComponents({ ...registry, components: [] }), /mapping/);
  assert.throws(() => generateNativeComponents({ ...registry, astryxVersion: undefined }), /version/);
  const first = registry.components[0];
  assert.throws(() => generateNativeComponents({ ...registry, components: [first, first] }), /Duplicate/);
  assert.throws(() => generateNativeComponents({
    ...registry, components: [first, { ...first, kind: "Different" }],
  }), /Duplicate/);
  assert.throws(() => generateNativeComponents({
    ...registry, components: [{ ...first, declaration: "" }],
  }), /Invalid/);
});
