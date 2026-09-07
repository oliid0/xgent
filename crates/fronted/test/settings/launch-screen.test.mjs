import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

for (const warm of [false, true]) {
  test(`${warm ? "repeat" : "first"} launch reveals only the intended painted surface`, async () => {
    const saved = new Map();
    const frames = [];
    const events = [];
    let removed = false;
    let inert = true;
    const previous = Object.fromEntries(["document", "window", "requestAnimationFrame", "matchMedia", "localStorage"].map(key => [key, globalThis[key]]));
    const loader = createTsModuleLoader({ mocks: {
      "@xgent/runtime": { isBrowserRuntime: () => false, invoke: async () => events.push(removed ? "app" : "splash") },
      "../runtimePlatform": { inferRuntimePlatform: () => "windows" },
    }});
    const launch = loader.loadModule("src/lib/system/launchScreen.ts");
    try {
      globalThis.document = {
        documentElement: { dataset: { warmLaunch: String(warm) } },
        getElementById: (id) => id === "root" ? { removeAttribute: () => { inert = false; } } : {
          remove: () => { removed = true; },
          classList: { add: value => events.push(value) },
          addEventListener: () => {},
        },
      };
      globalThis.window = { setTimeout: () => {} };
      globalThis.requestAnimationFrame = callback => frames.push(callback);
      globalThis.matchMedia = () => ({ matches: false });
      globalThis.localStorage = { setItem: (key, value) => saved.set(key, value) };
      launch.showFirstLaunch();
      assert.deepEqual(events, warm ? [] : ["splash"]);
      launch.finishLaunch();
      launch.finishLaunch(); // StrictMode cannot finish or animate twice.
      assert.equal(inert, true);
      assert.equal(saved.size, 0);
      while (frames.length) frames.shift()();
      assert.equal(inert, false);
      assert.equal(saved.get("xgent.launch-completed.v1"), "true");
      assert.equal(removed, warm);
      assert.deepEqual(events, warm ? ["app"] : ["splash", "launch-complete", "splash"]);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    }
  });
}
