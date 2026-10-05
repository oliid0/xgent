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

test("Android voice control changes the real persisted setting while preserving desktop credentials", () => {
  const mocks = {
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "./shared": { SettingsRow: "SettingsRow", SettingsRowGroup: "SettingsRowGroup" },
    "./useMobileAssistantAccess": { useMobileAssistantAccess: () => ({
      status: { voiceInputAvailable: true }, permissions: { microphone: "granted" }, busy: "", error: "", refresh() {},
    }) },
  };
  for (const [module, names] of Object.entries({
    Banner: ["Banner"], IconButton: ["IconButton"], Layout: ["VStack"], List: ["ListItem"],
    StatusDot: ["StatusDot"], Switch: ["Switch"], Text: ["Text"],
  })) mocks[`@astryxdesign/core/${module}`] = Object.fromEntries(names.map(name => [name, name]));
  const loader = createTsModuleLoader({ mocks });
  const { MobileVoiceSettingsSection } = loader.loadModule("src/pages/settings/MobileVoiceSettingsSection.tsx");
  let settings = loader.loadModule("src/lib/settings/index.ts").getDefaultSettings();
  settings.stt.providers.aliyun_dashscope.apiKey = "desktop-secret";
  let opened = false;
  const tree = MobileVoiceSettingsSection({ settings, setSettings: update => { settings = update(settings); },
    onOpenPermissions: () => { opened = true; },
  });
  const visit = value => Array.isArray(value) ? value.flatMap(visit) : value?.props
    ? [value, ...visit(value.props.children)] : [];
  const nodes = visit(tree);
  const toggle = nodes.find(node => node.type === "Switch");
  assert.equal(toggle.props.value, false); toggle.props.onChange(true);
  assert.equal(settings.stt.enabled, true);
  assert.equal(settings.stt.providers.aliyun_dashscope.apiKey, "desktop-secret");
  const permission = nodes.find(node => node.type === "ListItem");
  assert.equal(permission.props.description, "settings.mobileAssistant.granted");
  permission.props.onClick(); assert.equal(opened, true);
  assert.ok(!nodes.some(node => node.type === "TextInput"), "mobile OS speech does not request desktop provider credentials");
});
