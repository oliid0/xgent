import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("mobile voice toggle survives settings reload without a desktop STT command", async () => {
  const saved = new Map();
  const calls = [];
  let mobile = true;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  try {
    const loader = createTsModuleLoader({ mocks: {
      "@xgent/runtime": {
        isTauriRuntime: () => true,
        invoke: async (command) => {
          calls.push(command);
          if (command === "settings_load_all") return {};
          return {};
        },
      },
      "../runtimePlatform": { isNativeMobileRuntime: () => mobile },
      "../backup": { markBackupDirty: async () => {} },
    } });
    const storage = loader.loadModule("src/lib/settings/storage.ts");
    const initial = (await storage.loadPersistedSettingsWithDefaults()).settings;
    assert.equal(initial.stt.enabled, false);
    await storage.persistSettings(initial, { ...initial, stt: { ...initial.stt, enabled: true } });
    assert.ok(!calls.includes("settings_save_stt"));
    assert.equal(JSON.parse(saved.get("xgent.ui-settings.v1")).mobileVoiceEnabled, true);
    assert.equal((await storage.loadPersistedSettingsWithDefaults()).settings.stt.enabled, true);

    mobile = false;
    calls.length = 0;
    await storage.persistSettings(initial, { ...initial, stt: { ...initial.stt, enabled: true } });
    assert.ok(calls.includes("settings_save_stt"), "desktop STT still uses its native command");
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
