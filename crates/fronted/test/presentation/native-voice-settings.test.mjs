import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const allNodes = nodes => nodes.flatMap(node => [node, ...allNodes(node.children ?? [])]);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(service = { update: async value => value, test: async () => ({ result: "connected" }) }, mobile = false) {
  const hooks = createReactHookHarness();
  const empty = () => ({ nodes: [], handlers: new Map() });
  const locale = { SUPPORTED_LOCALES: ["system", "zh-CN", "en-US"], useLocale: () => ({ t: key => key }) };
  const sections = Object.fromEntries([
    "CronSection", "SshSettingsSection", "ComputerUseSection", "GlobalShortcutsSection", "HooksSection",
    "SoulSection", "BackupSyncSection", "NativeProviderRuntimeSettings", "NativeProviderModelSettings",
    "MobileEnvironmentBrowser", "ProjectRootsSection",
  ].map(name => [`../pages/settings/${name}`, { [name]: name }]));
  const loader = createTsModuleLoader({ mocks: {
    ...sections,
    react: hooks.react,
    "../i18n": locale,
    "../../i18n": locale,
    "../pages/settings/memory/MemoryPanel": { MemoryPanel: "MemoryPanel" },
    "./NativeSurface": { NativeSurface: "NativeSurface", retainNativeSurfaceSession() {}, removeNativeSurfaceSession() {} },
    "./nativeTheme": { createNativePresentationTheme: () => ({}) },
    "./nativeDesktopSystem": { useNativeDesktopSystem: empty },
    "./nativeDesktopProxy": { useNativeDesktopProxy: empty },
    "./nativeFontSettings": { useNativeFontSettings: empty },
    "./nativeAccessSettings": { useNativeAccessSettings: empty },
    "../lib/stt/desktopSttSettingsService": { desktopSttSettingsService: service },
    "../lib/mobileAssistant": {
      mobileAssistantStatus: async () => ({ voiceInputAvailable: true, permissionAliases: { microphone: "record" },
        detail: "HealthKit supports selected health metrics" }),
      checkMobileAssistantPermissions: async () => ({ microphone: "granted" }),
      normalizeMobileAssistantPermissions: (_status, permissions) => permissions,
    },
    "../pages/settings/useCodexOAuthAccounts": {
      useCodexOAuthAccounts: () => ({ status: { accounts: [] }, loaded: true, locked: false }),
    },
  } });
  const { NativeSettingsPage } = loader.loadModule("src/presentation/NativeSettingsPage.tsx");
  const { getDefaultSettings, normalizeSettings } = loader.loadModule("src/lib/settings/index.ts");
  const props = {
    settings: getDefaultSettings(), initialSection: "voice", nativeMobile: mobile,
    setSettings(update) { props.settings = update(props.settings); },
    saveState: { status: "saved" }, onBack() {}, appUpdate: {},
  };
  let rendered;
  const render = () => rendered = hooks.render(() => NativeSettingsPage(props));
  render();
  return {
    props, hooks, normalizeSettings, render,
    run: (id, value = null) => rendered.props.handlers.get(id).run(value),
    nodes: () => allNodes(rendered.props.document.nodes),
  };
}

test("native mobile voice describes device speech, preserves credentials and returns from real permissions", async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const f = fixture(undefined, true);
  try {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); f.render();
    const toggle = f.nodes().find(node => node.id === "voice-enabled");
    assert.equal(toggle.label, "settings.navVoice");
    assert.equal(toggle.icon, "mic");
    assert.equal(toggle.text, "settings.mobileAssistant.microphoneDescription");
    assert.ok(!f.nodes().some(node => node.kind === "TextInput" || node.id === "voice-device-detail"));
    assert.equal(f.nodes().find(node => node.id === "voice-device-status").label, "settings.native.speechAvailable");
    f.props.settings.stt.providers.aliyun_dashscope.apiKey = "desktop-secret";
    await f.run("voice-enabled", true); f.render();
    assert.equal(f.props.settings.stt.enabled, true);
    assert.equal(f.props.settings.stt.providers.aliyun_dashscope.apiKey, "desktop-secret");
    await f.run("voice-permissions"); f.render();
    assert.ok(f.nodes().some(node => node.id === "permission:microphone"));
    await f.run("back"); f.render();
    assert.equal(f.nodes().find(node => node.id === "voice-enabled").value, true);
  } finally {
    f.hooks.unmount();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("native desktop voice exposes all five provider schemas, saved secret hints and independent credentials", async () => {
  const f = fixture();
  const expected = {
    aliyun_dashscope: [["websocketUrl", false], ["model", false], ["apiKey", true]],
    tencent_cloud: [["appId", false], ["engineModelType", false], ["secretId", true], ["secretKey", true]],
    volcengine_v2: [["websocketUrl", false], ["appId", false], ["cluster", false], ["accessToken", true]],
    volcengine_seed_v3: [["websocketUrl", false], ["appId", false], ["resourceId", false], ["accessToken", true]],
    baidu_cloud: [["websocketUrl", false], ["baiduAppId", false], ["devPid", false], ["baiduApiKey", true]],
  };
  try {
    assert.deepEqual(f.nodes().find(node => node.id === "voice-provider").options.map(option => option.value), Object.keys(expected));
    assert.equal(f.nodes().find(node => node.id === "voice-enabled").text, "settings.stt.desc");
    await f.run("voice-enabled", true);
    assert.equal(f.props.settings.stt.enabled, true);
    f.render();
    for (const [provider, fields] of Object.entries(expected)) {
      await f.run("voice-provider", provider);
      f.props.settings = f.normalizeSettings({ ...f.props.settings, stt: {
        ...f.props.settings.stt, providers: { ...f.props.settings.stt.providers,
          [provider]: { ...f.props.settings.stt.providers[provider], configured: true } },
      } });
      f.render();
      const inputs = f.nodes().filter(node => node.kind === "TextInput" && node.id.startsWith("voice:"));
      assert.deepEqual(inputs.map(node => [node.id, node.secure]), fields.map(([key, secret]) => [`voice:${provider}:${key}`, secret]));
      for (const [key, secret] of fields) {
        assert.equal(inputs.find(node => node.id === `voice:${provider}:${key}`).text,
          secret ? "settings.stt.secretSaved" : undefined);
        await f.run(`voice:${provider}:${key}`, `${provider}-${key}`);
        f.render();
        assert.equal(f.props.settings.stt.providers[provider][key], `${provider}-${key}`);
      }
    }
    await f.run("voice-provider", "aliyun_dashscope");
    f.render();
    const retiredEdit = f.render().props.handlers.get("voice:aliyun_dashscope:apiKey");
    await f.run("voice-provider", "tencent_cloud");
    f.render();
    await retiredEdit.run("late-original-provider-edit");
    assert.equal(f.props.settings.stt.providers.aliyun_dashscope.apiKey, "late-original-provider-edit");
    assert.equal(f.props.settings.stt.providers.tencent_cloud.secretKey, "tencent_cloud-secretKey");
  } finally { f.hooks.unmount(); }
});

test("voice connection feedback retires on provider, credential and route changes while current tests remain usable", async () => {
  const calls = [], pending = [];
  const f = fixture({
    update: async value => value,
    test(provider) { calls.push(provider); const next = deferred(); pending.push(next); return next.promise; },
  });
  try {
    let running = f.run("voice-test");
    await Promise.resolve();
    f.render();
    await f.run("voice-provider", "tencent_cloud");
    f.render();
    pending[0].resolve({ result: "connected", message: "retired provider result" });
    await running;
    f.render();
    assert.ok(!f.nodes().some(node => node.id === "voice-test-result"));

    running = f.run("voice-test");
    await Promise.resolve();
    f.render();
    await f.run("voice:tencent_cloud:secretKey", "revised-key");
    f.render();
    pending[1].reject(new Error("retired credential error"));
    await running;
    f.render();
    assert.ok(!f.nodes().some(node => node.id === "error" || node.id === "voice-test-result"));
    assert.equal(f.render().props.handlers.get("voice-test").enabled, true);

    running = f.run("voice-test");
    await Promise.resolve();
    pending[2].resolve({ result: "connected_no_speech" });
    await running;
    f.render();
    assert.equal(f.nodes().find(node => node.id === "voice-test-result").label, "settings.stt.test.connected_no_speech");
    running = f.run("voice-test");
    await Promise.resolve();
    f.props.initialSection = "other";
    f.render();
    pending[3].resolve({ result: "connected", message: "retired route result" });
    await running;
    f.props.initialSection = "voice";
    f.render();
    assert.ok(!f.nodes().some(node => node.id === "voice-test-result"));
    assert.deepEqual(calls, ["aliyun_dashscope", "tencent_cloud", "tencent_cloud", "tencent_cloud"]);
  } finally { f.hooks.unmount(); }
});

test("voice stops retired tests before probing and exposes current connection failures for retry", async () => {
  const save = deferred();
  let probes = 0;
  const f = fixture({ update: () => save.promise, test: async () => { probes++; return { result: "connected" }; } });
  try {
    const running = f.run("voice-test");
    await f.run("voice-provider", "baidu_cloud");
    f.render();
    save.resolve(f.props.settings.stt);
    await running;
    assert.equal(probes, 0);
  } finally { f.hooks.unmount(); }

  const current = fixture({ update: async value => value, test: async () => { throw new Error("connection unavailable"); } });
  try {
    await assert.rejects(current.run("voice-test"), /connection unavailable/);
    current.render();
    assert.equal(current.nodes().find(node => node.id === "error").label, "connection unavailable");
    assert.equal(current.render().props.handlers.get("voice-test").enabled, true);
  } finally { current.hooks.unmount(); }
});
