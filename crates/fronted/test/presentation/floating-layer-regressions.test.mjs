import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const compatibilitySource = readSource("src/lib/system/layerCompatibility.ts");
const packagePatch = readSource("patches/@astryxdesign__core@0.6.0.patch");
const stylesSource = readSource("src/index.css");
const themeSource = readSource("src/theme/xgentTheme.ts");
const glassThemeSource = readSource("src/theme/glassTheme.ts");

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
  assert.match(compatibilitySource, /layer\.dataset\.layerReady = "true"/);
  assert.match(
    compatibilitySource,
    /Math\.min\(320, Math\.max\(200, anchor\.getBoundingClientRect\(\)\.width\)\)/,
  );
  assert.match(packagePatch, /contextPositioningRef\.current/);
  assert.match(packagePatch, /needsLayerCompatibility\(contextPositioningRef\.current\)/);
  assert.match(packagePatch, /positionCompatibleLayer\(popover, triggerRef\.current\)/);
  for (const attribute of ["placement", "alignment", "positioning"]) {
    assert.match(packagePatch, new RegExp(`data-layer-${attribute}`));
  }
  assert.match(packagePatch, /queueMicrotask\(\(\) => \{/);
  assert.match(packagePatch, /if \(!previous\.isConnected\) stopCompatibleLayer\(previous\)/);
  assert.match(packagePatch, /indicatorPosition = 'start'/);
  assert.match(packagePatch, /placement = 'below'/);
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

test("menus become visible only after measured placement and use the shared glass surface", () => {
  assert.match(
    stylesSource,
    /\[popover\]\[data-layer-ready="true"\]\[data-layer-positioning="anchor"\]/,
  );
  assert.match(stylesSource, /animation: xgent-menu-enter 160ms/);
  assert.match(
    stylesSource,
    /\.\\:popover-open:not\(\[data-layer-positioning="anchor"\]\)/,
  );
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(stylesSource, /\.astryx-selector-popup[\s\S]*?width: 100%/);
  assert.match(glassThemeSource, /"popover-surface"/);
});
