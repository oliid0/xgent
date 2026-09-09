import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { normalizeAppearance } = createTsModuleLoader().loadModule("src/lib/settings/appearance.ts");

test("older settings use the current theme and customized settings survive JSON persistence", () => {
  assert.equal(normalizeAppearance(undefined).preset, "current");
  assert.equal(normalizeAppearance(undefined).customized, false);
  for (const preset of ["current", "stone", "matcha"]) {
    const settings = { ...normalizeAppearance({}), preset, customized: true,
      accentLight: "#123456", sidebarDark: "#222222", radius: 24 };
    assert.deepEqual(normalizeAppearance(JSON.parse(JSON.stringify(settings))), settings);
  }
});

test("imported appearance data cannot inject CSS or non-finite dimensions", () => {
  const defaults = normalizeAppearance({});
  const malformed = normalizeAppearance({ preset: "unknown", customized: "true",
    accentLight: "red; background:url(https://example.test)", radius: Infinity });
  assert.deepEqual(malformed, defaults);
  assert.equal(normalizeAppearance({ radius: -10 }).radius, 0);
  assert.equal(normalizeAppearance({ radius: 90 }).radius, 32);
  assert.equal(normalizeAppearance({ accentDark: "#AABBCC" }).accentDark, "#aabbcc");
});
