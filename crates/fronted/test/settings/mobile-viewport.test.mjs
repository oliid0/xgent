import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { trackMobileViewport } = createTsModuleLoader().loadModule("src/lib/mobileViewport.ts");

test("mobile keyboard geometry follows resize/pan, ignores zoom and cleans up", () => {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  const view = Object.assign(new EventTarget(), { visualViewport: viewport, innerHeight: 800 });
  const values = new Map();
  const stop = trackMobileViewport(view, {
    setProperty: (key, value) => values.set(key, value),
    removeProperty: (key) => values.delete(key),
  });
  assert.equal(values.get("--xgent-viewport-height"), "800px");
  viewport.height = 430;
  viewport.offsetTop = 24;
  viewport.dispatchEvent(new Event("resize"));
  assert.equal(values.get("--xgent-viewport-height"), "430px");
  assert.equal(values.get("--xgent-viewport-top"), "24px");
  viewport.scale = 2;
  viewport.height = 200;
  viewport.dispatchEvent(new Event("resize"));
  assert.equal(values.get("--xgent-viewport-height"), "430px");
  stop();
  viewport.scale = 1;
  viewport.dispatchEvent(new Event("scroll"));
  view.dispatchEvent(new Event("resize"));
  assert.equal(values.size, 0);
});
