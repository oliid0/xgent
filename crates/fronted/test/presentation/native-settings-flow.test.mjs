import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("native settings mirrors compact navigation and persists shared system, provider, model and policy edits", async () => {
  const providerUtils = createTsModuleLoader().loadModule("src/pages/settings/providerUtils.ts");
  let discoveryOptions;
  let discoveryError;
  let discoveryPause;
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
        if (discoveryPause) await discoveryPause;
        if (discoveryError) throw discoveryError;
        return [providerUtils.createDraftModelConfig("codex", "fetched-model")];
      },
    },
    "../pages/settings/CronSection": { CronSection: "CronSection" },
    "../pages/settings/SshSettingsSection": { SshSettingsSection: "SshSettingsSection" },
    "../pages/settings/ComputerUseSection": { ComputerUseSection: "ComputerUseSection" },
    "../pages/settings/GlobalShortcutsSection": { GlobalShortcutsSection: "GlobalShortcutsSection" },
    "../pages/settings/HooksSection": { HooksSection: "HooksSection" },
    "../pages/settings/SoulSection": { SoulSection: "SoulSection" },
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
      ["mobile-theme", "settings.native.theme", ["theme", "appearance-preset", "appearance-customized"]],
      ["mobile-appearance", "settings.mobile.appearanceGroup", ["nav:system", "nav:providers"]],
      ["mobile-personal", "settings.mobile.personalGroup", ["nav:soul", "nav:memory"]],
      ["mobile-capabilities", "settings.mobile.capabilitiesGroup", [
        "nav:mobileAssistant", "nav:toolPermissions", "nav:mobileExecution", "nav:voice", "nav:other", "nav:access", "nav:backup", "nav:about",
      ]],
    ],
  );
  assert.ok(!document.nodes.some((node) => node.id === "save-status"));
  const navigationRows = document.nodes.flatMap((node) => node.children ?? []).filter((node) => node.kind === "NavigationRow");
  assert.ok(navigationRows.every((node) => node.text), "compact navigation keeps row descriptions");
  assert.equal(document.formFactor, "mobile");
  assert.deepEqual(document.theme, { marker: "theme" });
  assert.equal((await dispatch("theme", "light")).ok, true);
  assert.equal(settings.theme, "light");
  assert.equal((await dispatch("appearance-preset", "stone")).ok, true);
  assert.equal(settings.customSettings.appearance.preset, "stone");
  assert.equal((await dispatch("appearance-customized", true)).ok, true);
  assert.deepEqual(
    document.nodes.find((node) => node.id === "mobile-theme").children.slice(-2).map((node) => node.id),
    ["accent-light", "accent-dark"],
  );
  assert.equal((await dispatch("accent-light", "#ABCDEF")).ok, true);
  assert.equal((await dispatch("accent-dark", "#123456")).ok, true);
  assert.equal(settings.customSettings.appearance.accentLight, "#abcdef");
  assert.equal(settings.customSettings.appearance.accentDark, "#123456");
  assert.equal((await dispatch("appearance-preset", "matcha")).ok, true);
  assert.equal(settings.customSettings.appearance.customized, false);
  assert.ok(!document.nodes.find((node) => node.id === "mobile-theme").children.some((node) => node.id === "accent-light"));
  await dispatch("nav:system");
  assert.ok(document.nodes.some((node) => node.id === "save-status"));
  assert.equal((await dispatch("language", "zh-CN")).ok, true);
  assert.equal((await dispatch("mode", "text")).ok, true);
  assert.equal(settings.locale, "zh-CN");
  assert.equal(settings.system.executionMode, "text");
  assert.equal(settings.theme, "light", "system navigation preserves the root appearance selection");
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
  const modelsUrlEdit = await dispatch("provider-models-url", " https://catalog.example.test/v1/models ");
  assert.equal(modelsUrlEdit.acceptedValue, "https://catalog.example.test/v1/models");
  discoveryError = new Error("Model list request timed out after 10 seconds");
  assert.equal((await dispatch("fetch-models")).ok, false);
  assert.equal(document.nodes.find(node => node.id === "error").label, discoveryError.message);
  assert.equal(document.nodes.find(node => node.id === "error").kind, "Banner");
  assert.ok(!document.nodes.some(node => node.id === "busy"));
  assert.ok(rendered.props.handlers.get("fetch-models").enabled, "failure releases the action for retry");
  discoveryError = undefined;
  assert.equal((await dispatch("fetch-models")).ok, true);
  assert.equal(discoveryOptions.modelsUrl, "https://catalog.example.test/v1/models");
  assert.ok(settings.customProviders.at(-1).activeModels.includes("fetched-model"));
  assert.deepEqual(settings.selectedModel, {
    customProviderId: settings.customProviders.at(-1).id,
    model: "fetched-model",
  });
  const fetchingProviderId = settings.customProviders.at(-1).id;
  let releaseDiscovery;
  discoveryPause = new Promise(resolve => { releaseDiscovery = resolve; });
  const pendingDiscovery = registry.dispatch({ surface: "settings", action: "fetch-models", value: null, requestId: String(++request) });
  await Promise.resolve();
  render();
  assert.ok(document.nodes.some(node => node.id === "busy"));
  await dispatch("back");
  assert.ok(!document.nodes.some(node => node.id === "busy"), "pending work on a detail page must not lock the settings root");
  const otherProvider = settings.customProviders.find(item => item.id !== fetchingProviderId);
  await dispatch(`provider:${otherProvider.id}`);
  assert.ok(rendered.props.handlers.get("fetch-models").enabled, "one provider request must not disable another provider");
  releaseDiscovery();
  await pendingDiscovery;
  discoveryPause = undefined;
  await dispatch("back");
  await dispatch(`provider:${fetchingProviderId}`);
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
  await dispatch("back");
  assert.ok(!document.nodes.flatMap((node) => node.children ?? []).some((node) => node.id === "nav:skills" || node.id === "nav:mcp"));
});

test("native Shell install reports progress, errors, and live and final package output", async () => {
  const states = [];
  const effects = [];
  let cursor = 0;
  let installCalls = 0;
  let onProgress;
  let installFailure;
  let onOutput;
  let completeToolchains;
  let toolchainRunId;
  let outputUnsubscribed = false;
  let selectedMirror;
  const locale = { SUPPORTED_LOCALES: ["en-US"], useLocale: () => ({ t: (key) => key }) };
  const shellStatus = {
    backend: "ios-a-shell", available: false, installed: false,
    detail: "Bundle assets missing", toolchains: [], capabilities: { shell: false },
  };
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useEffect(effect) { effects.push(effect); },
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
    "../lib/mobileExecution": {
      mobileExecutionStatus: async () => shellStatus,
      listExternalMobileWorkspaces: async () => [],
      installMobileEnvironment: () => {
        installCalls++;
        return new Promise((_resolve, reject) => { installFailure = reject; });
      },
      listenMobileEnvironmentInstallProgress: async (handler) => {
        onProgress = handler;
        return () => { onProgress = undefined; };
      },
      listenMobileExecutionOutput: async (handler) => {
        onOutput = handler;
        return async () => { onOutput = undefined; outputUnsubscribed = true; };
      },
      installMobileToolchains: (_toolchains, runId) => {
        toolchainRunId = runId;
        return new Promise((resolve) => { completeToolchains = resolve; });
      },
      setMobileAlpineMirror: async (id) => {
        selectedMirror = id;
        shellStatus.selectedAlpineMirror = id;
        return shellStatus;
      },
      mobileEnvironmentInstallLabel: (progress) => progress?.phase ?? "Installing",
    },
  } });
  const { NativeSettingsPage } = loader.loadModule("src/presentation/NativeSettingsPage.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let document;
  const render = () => {
    cursor = 0;
    const view = NativeSettingsPage({ settings: getDefaultSettings(), setSettings() {},
      nativeMobile: true, initialSection: "mobileExecution", saveState: { status: "saved" }, onBack() {}, appUpdate: {} });
    document = view.props.document;
    registry.register("settings-install", view.props.handlers);
  };
  render();
  for (const effect of effects.splice(0)) {
    if (String(effect).includes("refreshShell")) effect();
  }
  await new Promise((resolve) => setImmediate(resolve));
  render();
  const pending = registry.dispatch({ surface: "settings-install", action: "install-shell", value: null, requestId: "1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(installCalls, 1, "an unavailable status still permits a diagnostic install attempt");
  onProgress({ phase: "copying", percent: 40 });
  render();
  assert.equal(document.nodes.find((node) => node.id === "busy")?.label, "copying");
  installFailure(new Error("Missing bundled a-Shell resources"));
  assert.equal((await pending).ok, false);
  render();
  assert.match(document.nodes.find((node) => node.id === "error")?.label ?? "", /Missing bundled/);
  assert.equal(onProgress, undefined, "listener is removed after a failed install");

  shellStatus.backend = "android-proot";
  shellStatus.available = true;
  shellStatus.installed = true;
  shellStatus.toolchains = [{ id: "essentials", label: "Essentials", installed: false, installable: true }];
  await registry.dispatch({ surface: "settings-install", action: "refresh-shell", value: null, requestId: "2" });
  render();
  await registry.dispatch({ surface: "settings-install", action: "shell-pack:essentials", value: true, requestId: "3" });
  render();
  const installing = registry.dispatch({ surface: "settings-install", action: "install-shell-packs", value: null, requestId: "4" });
  await new Promise((resolve) => setImmediate(resolve));
  onOutput({ runId: toolchainRunId, stream: "stdout",
    data: Buffer.from("Downloading packages\n").toString("base64") });
  render();
  assert.match(document.nodes.find((node) => node.id === "shell-toolchains")?.children
    .find((node) => node.id === "shell-install-output")?.text ?? "", /Downloading packages/);
  completeToolchains({ succeeded: true, stdout: "Packages installed\n", stderr: "", status: [], exitCode: 0 });
  assert.equal((await installing).ok, true);
  render();
  assert.match(document.nodes.find((node) => node.id === "shell-toolchains")?.children
    .find((node) => node.id === "shell-install-output")?.text ?? "", /Packages installed/);
  assert.equal(outputUnsubscribed, true);

  shellStatus.alpineMirrors = [
    { id: "official", name: "Official CDN" },
    { id: "tuna", name: "Tsinghua TUNA" },
  ];
  shellStatus.selectedAlpineMirror = "official";
  await registry.dispatch({ surface: "settings-install", action: "refresh-shell", value: null, requestId: "5" });
  render();
  assert.equal(document.nodes.find((node) => node.id === "shell-mirror")?.children
    .find((node) => node.id === "alpine-mirror")?.value, "official");
  assert.equal((await registry.dispatch({ surface: "settings-install", action: "alpine-mirror",
    value: "tuna", requestId: "6" })).ok, true);
  render();
  assert.equal(selectedMirror, "tuna");
  assert.equal(document.nodes.find((node) => node.id === "shell-mirror")?.children
    .find((node) => node.id === "alpine-mirror")?.value, "tuna");
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
