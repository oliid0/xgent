import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("global shortcut replacements are applied in request order", async () => {
  const calls = [];
  const releases = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        invoke(command, args) {
          assert.equal(command, "app_set_global_shortcuts");
          calls.push(args.bindings);
          return new Promise((resolve) => releases.push(() => resolve([])));
        },
      },
    },
  });
  const shortcuts = loader.loadModule("src/lib/shortcuts/globalShortcuts.ts");

  const unregister = shortcuts.applyGlobalShortcuts({});
  const register = shortcuts.applyGlobalShortcuts({
    summon: { accelerator: "Ctrl+KeyK", enabled: true },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], []);

  releases.shift()();
  await unregister;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [{ action: "summon", accelerator: "Ctrl+KeyK" }]);

  releases.shift()();
  assert.deepEqual(await register, []);
});

test("global shortcut registration failures are returned to the settings UI", async () => {
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        invoke() {
          return Promise.reject(new Error("native registration unavailable"));
        },
      },
    },
  });
  const shortcuts = loader.loadModule("src/lib/shortcuts/globalShortcuts.ts");

  const failures = await shortcuts.applyGlobalShortcuts({
    summon: { accelerator: "Ctrl+KeyK", enabled: true },
  });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].action, "runtime");
  assert.match(failures[0].error, /native registration unavailable/);
});
