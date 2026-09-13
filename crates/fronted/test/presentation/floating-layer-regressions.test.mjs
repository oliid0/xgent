import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const compatibilitySource = readSource("src/lib/system/layerCompatibility.ts");
const packagePatch = readSource("patches/@astryxdesign__core@0.6.0.patch");
const stylesSource = readSource("src/index.css");
const themeSource = readSource("src/theme/xgentTheme.ts");

test("every standard Astryx context layer uses measured trigger geometry", () => {
  assert.match(
    compatibilitySource,
    /positioning !== "custom"/,
    "consumer-owned custom geometry must remain untouched",
  );
  for (const primitive of ["computePosition", "autoUpdate", "offset", "flip", "shift", "size"]) {
    assert.match(compatibilitySource, new RegExp(`\\b${primitive}\\b`));
  }
  assert.match(compatibilitySource, /strategy: "fixed"/);
  assert.match(compatibilitySource, /anchor\?\.isConnected/);
  assert.match(compatibilitySource, /layer\.dataset\.layerPlacement/);
  assert.match(packagePatch, /contextPositioningRef\.current/);
  assert.match(packagePatch, /needsLayerCompatibility\(contextPositioningRef\.current\)/);
  assert.match(packagePatch, /positionCompatibleLayer\(popover, triggerRef\.current\)/);
  for (const attribute of ["placement", "alignment", "positioning"]) {
    assert.match(packagePatch, new RegExp(`data-layer-${attribute}`));
  }
});

test("closed polyfilled popovers cannot leak tooltip text into the workspace", () => {
  assert.match(
    stylesSource,
    /@supports not selector\(:popover-open\) \{\s*\[popover\]:not\(\.\\:popover-open\) \{\s*display: none !important/,
  );
});

test("light modal glass samples the page through a light veil instead of a gray scrim", () => {
  assert.match(themeSource, /"--color-overlay": \["#ffffff14", "#00000073"\]/);
  assert.match(stylesSource, /\.settings-page-desktop \{\s*background: transparent/);
  assert.match(
    stylesSource,
    /\.settings-page-desktop\s+\[data-settings-section\][\s\S]*?backdrop-filter: var\(--xgent-material-filter, none\)/,
  );
});
