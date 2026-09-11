import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { getDefaultSettings, normalizeSettings, normalizeTheme } = loader.loadModule("src/lib/settings/index.ts");

test("fresh settings and missing preferences follow the system without overriding explicit choices", () => {
  assert.equal(getDefaultSettings().theme, "system");
  assert.equal(normalizeSettings({}).theme, "system");
  for (const value of [undefined, null, "auto", "system", "invalid"]) {
    assert.equal(normalizeTheme(value), "system");
  }
  for (const theme of ["light", "dark"]) {
    assert.equal(normalizeSettings({ theme }).theme, theme);
  }
});
