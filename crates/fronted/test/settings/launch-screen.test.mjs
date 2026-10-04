import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

for (const warm of [false, true]) {
  test(`${warm ? "repeat" : "first"} launch reveals the shell immediately without a splash`, async () => {
    const saved = new Map();
    const frames = [];
    const events = [];
    let removed = false;
    const previous = Object.fromEntries(["document", "window", "requestAnimationFrame", "matchMedia", "localStorage"].map(key => [key, globalThis[key]]));
    const loader = createTsModuleLoader({ mocks: {
      "@xgent/runtime": { isBrowserRuntime: () => false, invoke: async () => events.push(removed ? "app" : "splash") },
      "../runtimePlatform": { inferRuntimePlatform: () => "windows" },
    }});
    const launch = loader.loadModule("src/lib/system/launchScreen.ts");
    try {
      globalThis.document = {
        documentElement: { dataset: { initialized: String(warm) } },
        getElementById: () => ({
          remove: () => { removed = true; },
          classList: { add: value => events.push(value) },
          addEventListener: () => {},
        }),
      };
      globalThis.window = { setTimeout: () => {} };
      globalThis.requestAnimationFrame = callback => frames.push(callback);
      globalThis.matchMedia = () => ({ matches: false });
      globalThis.localStorage = { setItem: (key, value) => saved.set(key, value) };
      launch.showFirstLaunch();
      assert.deepEqual(events, []);
      while (frames.length) frames.shift()();
      assert.deepEqual(events, ["splash"]);
      launch.finishLaunch();
      launch.finishLaunch(); // StrictMode cannot finish or animate twice.
      assert.equal(saved.size, 0);
      while (frames.length) frames.shift()();
      assert.equal(saved.get("xgent.launch-completed.v1"), "true");
      assert.equal(removed, true);
      assert.deepEqual(events, ["splash", "app"]);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    }
  });
}

for (const platform of ["ios", "macos"]) {
  test(`${platform} native launch finishes while the hidden WebKit host receives no animation frames`, async () => {
    const previous = Object.fromEntries(["window", "document", "requestAnimationFrame", "localStorage"].map(key => [key, globalThis[key]]));
    const commands = [], saved = new Map();
    let removed = 0, frames = 0;
    const loader = createTsModuleLoader({ mocks: {
      "@xgent/runtime": { isBrowserRuntime: () => false, invoke: async command => commands.push(command) },
      "../runtimePlatform": { inferRuntimePlatform: () => platform },
      "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    } });
    try {
      globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ remove: () => removed++ }) };
      globalThis.window = {};
      globalThis.requestAnimationFrame = () => { frames++; }; // Never deliver a frame.
      globalThis.localStorage = { setItem: (key, value) => saved.set(key, value) };
      const launch = loader.loadModule("src/lib/system/launchScreen.ts");
      launch.showFirstLaunch();
      assert.equal(commands.length, platform === "macos" ? 1 : 0);
      launch.finishLaunch();
      launch.finishLaunch();
      await Promise.resolve();
      assert.equal(frames, 0);
      assert.equal(removed, 1);
      assert.equal(saved.get("xgent.launch-completed.v1"), "true");
      assert.equal(commands.length, platform === "macos" ? 2 : 0);
      assert.ok(commands.every(command => command === "app_frontend_ready"));
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
  });

  test(`${platform} boot failure uses native recovery, a real reload action and retires on painted launch`, async () => {
    const previous = Object.fromEntries(["window", "document", "requestAnimationFrame", "localStorage"].map(key => [key, globalThis[key]]));
    const documents = [], frames = [], commands = [], acknowledgements = [];
    let receive, reloads = 0, domReads = 0, unsubscribed = 0;
    const loader = createTsModuleLoader({ mocks: {
      "@xgent/runtime": { isBrowserRuntime: () => false, invoke: async command => commands.push(command) },
      "../runtimePlatform": { inferRuntimePlatform: () => platform },
      "../../runtime/applePresentation": { isApplePresentationRuntime: () => true,
        publishApplePresentation: async document => { documents.push(document); },
        subscribeApplePresentation: handler => { receive = handler; return () => unsubscribed++; },
        acknowledgeApplePresentation: async result => { acknowledgements.push(result); } },
    } });
    try {
      globalThis.window = { location: { reload: () => reloads++ } };
      globalThis.document = { documentElement: { dataset: {} }, getElementById: () => { domReads++; return { remove() {} }; } };
      globalThis.requestAnimationFrame = run => frames.push(run);
      globalThis.localStorage = { setItem() {} };
      const launch = loader.loadModule("src/lib/system/launchScreen.ts");
      launch.showFirstLaunch(); assert.equal(document.documentElement.dataset.nativePresentation, "true");
      launch.showLaunchFailure(new Error("Chat controller import failed"));
      for (let i = 0; i < 12; i++) await Promise.resolve();
      assert.equal(domReads, 0); assert.equal(documents[0].nodes[0].text, "Chat controller import failed");
      assert.equal(documents[0].formFactor, platform === "ios" ? "mobile" : "desktop");
      receive({ surface: documents[0].surface, action: "launch:reload", requestId: "reload", value: null });
      for (let i = 0; i < 12; i++) await Promise.resolve();
      assert.equal(reloads, 1); assert.equal(acknowledgements[0].ok, true);
      launch.finishLaunch(false);
      for (let i = 0; i < 12; i++) await Promise.resolve();
      while (frames.length) frames.shift()();
      assert.equal(unsubscribed, 1); assert.equal(documents.at(-1).removed, true);
      assert.equal(commands.length > 0, platform === "macos");
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
  });
}
