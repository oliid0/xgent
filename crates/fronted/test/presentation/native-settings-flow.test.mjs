import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("native settings navigation persists provider, model, appearance and policy edits through shared reducers", async () => {
  const states = [];
  let cursor = 0;
  const locale = {
    SUPPORTED_LOCALES: ["system", "zh-CN", "en-US"],
    useLocale: () => ({ t: (key) => key, locale: "en-US" }),
  };
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useEffect() {},
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
    },
    "../i18n": locale,
    "../../i18n": locale,
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => ({ marker: "theme" }) },
    "../pages/settings/CronSection": { CronSection: "CronSection" },
    "../pages/settings/SshSettingsSection": { SshSettingsSection: "SshSettingsSection" },
    "../pages/settings/ComputerUseSection": { ComputerUseSection: "ComputerUseSection" },
    "../pages/settings/GlobalShortcutsSection": { GlobalShortcutsSection: "GlobalShortcutsSection" },
    "../pages/settings/HooksSection": { HooksSection: "HooksSection" },
    "../pages/settings/SoulSection": { SoulSection: "SoulSection" },
    "../pages/chat/mobile/MobileSkillsPage": { MobileSkillsPage: "MobileSkillsPage" },
  } });
  const { NativeSettingsPage } = loader.loadModule("src/presentation/NativeSettingsPage.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let settings = getDefaultSettings();
  let document;
  let request = 0;
  const render = () => {
    cursor = 0;
    const result = NativeSettingsPage({ settings, setSettings: (update) => { settings = update(settings); },
      nativeMobile: true, initialSection: "system", saveState: { status: "saved" }, onBack() {}, appUpdate: {} });
    document = result.props.document;
    registry.register("settings", result.props.handlers);
  };
  const dispatch = async (action, value = null) => {
    const result = await registry.dispatch({ surface: "settings", action, value, requestId: String(++request) });
    render();
    return result;
  };
  render();
  const rootNavigation = document.nodes.find((node) => node.id === "app-settings").children;
  for (const id of ["providers", "toolPermissions", "voice", "mcp", "other", "access", "backup", "soul", "memory", "skills", "about"]) {
    assert.ok(rootNavigation.some((node) => node.id === `nav:${id}`), id);
  }
  assert.ok(rootNavigation.some((node) => node.id === "nav:mobileAssistant"));
  assert.ok(rootNavigation.some((node) => node.id === "nav:mobileExecution"));
  assert.ok(!rootNavigation.some((node) => node.id === "nav:shortcuts"));
  assert.ok(!rootNavigation.some((node) => node.id === "nav:computerUse"));
  assert.equal((await dispatch("theme", "dark")).ok, true);
  assert.equal(document.appearance, "dark");
  assert.equal((await dispatch("theme", "invalid")).ok, false);
  assert.equal(document.formFactor, "mobile");
  assert.deepEqual(document.theme, { marker: "theme" });
  assert.equal((await dispatch("appearance-customized", true)).ok, true);
  assert.equal((await dispatch("accent-light", "#12ABEF")).ok, true);
  assert.equal(settings.customSettings.appearance.accentLight, "#12abef");
  assert.equal((await dispatch("accent-light", "blue")).ok, false);
  assert.equal((await dispatch("font-scale:chat", "1.2")).ok, true);
  assert.equal(settings.customSettings.fontScale.chat, 1.2);
  await dispatch("nav:voice");
  const mobileVoice = document.nodes.find((node) => node.id === "voice-general").children;
  assert.deepEqual(
    mobileVoice.map((node) => node.id),
    ["voice-enabled", "voice-device-status", "voice-permissions"],
  );
  assert.ok(!document.nodes.some((node) => node.id === "voice-provider-fields"));
  assert.equal((await dispatch("voice-enabled", true)).ok, true);
  assert.equal(settings.stt.enabled, true);
  assert.equal((await dispatch("voice-permissions")).ok, true);
  assert.ok(document.nodes.some((node) => node.id === "refresh-permissions"));
  await dispatch("back");
  await dispatch("nav:providers");
  const count = settings.customProviders.length;
  assert.equal((await dispatch("add-provider")).ok, true);
  assert.equal(settings.customProviders.length, count + 1);
  await dispatch("provider-name", "Local relay");
  await dispatch("provider-url", "https://example.test/v1");
  await dispatch("model-id", "example-model");
  assert.equal((await dispatch("add-model")).ok, true);
  const provider = settings.customProviders.at(-1);
  assert.equal(provider.name, "Local relay");
  assert.equal(provider.baseUrl, "https://example.test/v1");
  assert.ok(provider.activeModels.includes("example-model"));
  assert.ok(provider.models.some((model) => model.id === "example-model"));
  await dispatch("back");
  await dispatch("back");
  await dispatch("nav:toolPermissions");
  assert.equal((await dispatch("policy:Bash", "deny")).ok, true);
  assert.equal(settings.system.toolPolicies.Bash, "deny");
});

test("system picker payload rejects malformed files and preserves bytes and MIME type", () => {
  const loader = createTsModuleLoader();
  const { decodeNativeFiles } = loader.loadModule("src/presentation/nativeFiles.ts");
  assert.throws(() => decodeNativeFiles("{}"), /Invalid/);
  assert.throws(() => decodeNativeFiles('[{"fileName":"test"}]'), /Invalid/);
  assert.throws(() => decodeNativeFiles(JSON.stringify(Array(10).fill({}))), /Invalid/);
  const [file] = decodeNativeFiles(JSON.stringify([{ fileName: "hello.txt", mimeType: "text/plain", contentBase64: "aGVsbG8=" }]));
  assert.equal(file.name, "hello.txt");
  assert.equal(file.type, "text/plain");
  assert.equal(file.size, 5);
});
