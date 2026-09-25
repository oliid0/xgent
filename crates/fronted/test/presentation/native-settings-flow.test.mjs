import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("native settings mirrors compact navigation and persists shared system, provider, model and policy edits", async () => {
  const providerUtils = createTsModuleLoader().loadModule("src/pages/settings/providerUtils.ts");
  let discoveryOptions;
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
    "../pages/settings/providerUtils": {
      ...providerUtils,
      fetchModelsFromApi: async (_type, _baseUrl, _apiKey, options) => {
        discoveryOptions = options;
        return [providerUtils.createDraftModelConfig("codex", "fetched-model")];
      },
    },
    "../pages/settings/CronSection": { CronSection: "CronSection" },
    "../pages/settings/SshSettingsSection": { SshSettingsSection: "SshSettingsSection" },
    "../pages/settings/ComputerUseSection": { ComputerUseSection: "ComputerUseSection" },
    "../pages/settings/GlobalShortcutsSection": { GlobalShortcutsSection: "GlobalShortcutsSection" },
    "../pages/settings/HooksSection": { HooksSection: "HooksSection" },
    "../pages/settings/SoulSection": { SoulSection: "SoulSection" },
    "../pages/chat/mobile/MobileSkillsPage": { MobileSkillsPage: "MobileSkillsPage" },
    "../pages/chat/mobile/MobileMcpPage": { MobileMcpPage: "MobileMcpPage" },
  } });
  const { NativeSettingsPage } = loader.loadModule("src/presentation/NativeSettingsPage.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let settings = getDefaultSettings();
  let document;
  let rendered;
  let request = 0;
  const render = () => {
    cursor = 0;
    const result = NativeSettingsPage({ settings, setSettings: (update) => { settings = update(settings); },
      nativeMobile: true, initialSection: "system", saveState: { status: "saved" }, onBack() {}, appUpdate: {} });
    document = result.props.document;
    rendered = result;
    if (result.props.handlers) registry.register("settings", result.props.handlers);
  };
  const dispatch = async (action, value = null) => {
    const result = await registry.dispatch({ surface: "settings", action, value, requestId: String(++request) });
    render();
    return result;
  };
  render();
  assert.deepEqual(
    document.nodes.filter((node) => node.kind === "SettingsGroup").map((group) => [
      group.id,
      group.label,
      group.children.map((node) => node.id),
    ]),
    [
      ["mobile-appearance", "settings.mobile.appearanceGroup", ["nav:system", "nav:providers"]],
      ["mobile-personal", "settings.mobile.personalGroup", ["nav:soul", "nav:memory"]],
      ["mobile-capabilities", "settings.mobile.capabilitiesGroup", [
        "nav:mobileAssistant", "nav:toolPermissions", "nav:mobileExecution", "nav:other", "nav:access", "nav:backup", "nav:about",
      ]],
    ],
  );
  assert.ok(!document.nodes.some((node) => node.id === "save-status"));
  const navigationRows = document.nodes.flatMap((node) => node.children ?? []);
  assert.ok(navigationRows.every((node) => node.text), "compact navigation keeps row descriptions");
  assert.equal(document.formFactor, "mobile");
  assert.deepEqual(document.theme, { marker: "theme" });
  await dispatch("nav:system");
  assert.ok(document.nodes.some((node) => node.id === "save-status"));
  assert.equal((await dispatch("language", "zh-CN")).ok, true);
  assert.equal((await dispatch("mode", "text")).ok, true);
  assert.equal(settings.locale, "zh-CN");
  assert.equal(settings.system.executionMode, "text");
  assert.equal(settings.theme, "system", "native mobile preserves the system appearance contract");
  await dispatch("back");
  await dispatch("nav:providers");
  const count = settings.customProviders.length;
  assert.equal((await dispatch("add-provider")).ok, true);
  assert.equal(settings.customProviders.length, count + 1);
  await dispatch("provider-name", "Local relay");
  const endpoint = "https://example.test/v1/chat/completions";
  await dispatch("provider-url", endpoint);
  assert.equal(settings.customProviders.at(-1).baseUrl, "https://example.test/v1");
  assert.equal(settings.customProviders.at(-1).requestFormat, "openai-completions");
  await dispatch("full-url", true);
  assert.equal(settings.customProviders.at(-1).baseUrl, endpoint,
    "enabling exact URL after entering it must preserve its endpoint suffix");
  await dispatch("full-url", false);
  assert.equal(settings.customProviders.at(-1).baseUrl, "https://example.test/v1");
  const urlField = document.nodes.flatMap((node) => node.children ?? []).find((node) => node.id === "provider-url");
  assert.equal(urlField.value, endpoint, "editing retains the entered endpoint across normalization");
  await dispatch("provider-url", "https://example.test/v1");
  await dispatch("provider-models-url", "https://catalog.example.test/v1/models");
  assert.equal((await dispatch("fetch-models")).ok, true);
  assert.equal(discoveryOptions.modelsUrl, "https://catalog.example.test/v1/models");
  assert.ok(settings.customProviders.at(-1).activeModels.includes("fetched-model"));
  assert.deepEqual(settings.selectedModel, {
    customProviderId: settings.customProviders.at(-1).id,
    model: "fetched-model",
  });
  await dispatch("model-id", "example-model");
  assert.equal((await dispatch("add-model")).ok, true);
  const provider = settings.customProviders.at(-1);
  assert.equal(provider.name, "Local relay");
  assert.equal(provider.baseUrl, "https://example.test/v1");
  assert.ok(provider.activeModels.includes("example-model"));
  assert.ok(provider.models.some((model) => model.id === "example-model"));
  assert.equal(settings.selectedModel.model, "fetched-model", "manual additions preserve the chosen model");
  await dispatch("back");
  await dispatch("back");
  await dispatch("nav:mobileAssistant");
  assert.ok(!document.nodes.flatMap((node) => node.children ?? []).some((node) => node.id === "policy:Bash"));
  assert.equal((await dispatch("personal-policy:clipboard", "deny")).ok, true);
  assert.equal(settings.system.toolPolicies["personal:clipboard"], "deny");
  assert.ok(document.nodes.some((node) => node.id === "personal-access"));
  await dispatch("back");
  await dispatch("nav:toolPermissions");
  assert.ok(document.nodes.flatMap((node) => node.children ?? []).some((node) => node.id === "policy:Bash"));
  assert.equal((await dispatch("policy:Bash", "deny")).ok, true);
  assert.equal(settings.system.toolPolicies.Bash, "deny");
  assert.equal(settings.system.toolPolicies["personal:clipboard"], "deny");
  await dispatch("back");
  await dispatch("nav:other");
  for (const [section, component] of [["ssh", "SshSettingsSection"], ["cron", "CronSection"], ["hooks", "HooksSection"]]) {
    assert.equal((await dispatch(`nav:${section}`)).ok, true);
    assert.equal(rendered.type, component);
    assert.notEqual(rendered.props.openCreateImmediately, true, "enter the management list, not an unsolicited creation form");
    rendered.props.onBack();
    render();
    assert.equal(document.mode, "sheet");
    assert.ok(document.nodes.flatMap((node) => node.children ?? []).some((node) => node.id === `nav:${section}`), "return to the invoking settings category");
  }
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
