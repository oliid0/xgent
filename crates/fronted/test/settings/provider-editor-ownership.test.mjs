import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function elements(value) {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (value?.label && typeof value.onClick === "function") return [{ type: "menuitem", props: value }];
  if (!value?.type || !value.props) return [];
  return [value, ...Object.values(value.props).flatMap(elements)];
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function fixture(overrides = {}) {
  const pageHooks = createReactHookHarness(), editorHooks = createReactHookHarness();
  let activeHooks = pageHooks;
  const react = { ...React, ...Object.fromEntries(Object.keys(pageHooks.react).map(key => [key, (...args) => activeHooks.react[key](...args)])) };
  const utils = createTsModuleLoader().loadModule("src/pages/settings/providerUtils.ts");
  const requests = [], usageRequests = [], saved = [];
  let closed = 0;
  let saveError = null;
  const loader = createTsModuleLoader({ mocks: {
    react, "@astryxdesign/core/hooks": { useMediaQuery: () => true },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/providers/usageQuery": {
      useProviderUsage: () => ({ getState: () => ({ loading: false }), refresh() {} }),
      testProviderUsage: (id, config) => {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        usageRequests.push({ id, config: structuredClone(config), resolve, reject });
        return promise;
      },
    },
    "./providerUtils": { ...utils, isBrowserRuntime: () => false, fetchModelsFromApi: (...args) => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ args, resolve, reject }); return promise;
    } },
    "./CodexOAuthAccounts": {}, "./ModelFailoverSection": {}, "./RetryErrorSection": {},
  } });
  const { ProvidersSection } = loader.loadModule("src/pages/settings/ProvidersSection.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const provider = { id: "a", type: "claude_code", name: "Draft", baseUrl: "https://old.test/v1", apiKey: "old-key", models: [], activeModels: [], customHeaders: [], useSystemProxy: false, ...overrides };
  const props = { settings: { ...getDefaultSettings(), customProviders: [provider] }, setSettings() {}, thirdPartyImportEnabled: false };
  let page = pageHooks.render(() => ProvidersSection(props));
  elements(page).find(node => node.type.name === "ProviderList").props.onEdit(provider);
  page = pageHooks.render(() => ProvidersSection(props));
  const editor = elements(page).find(node => node.type.name === "ProviderEditor");
  const editorProps = { ...editor.props, providerType: provider.type, onSave: data => {
    if (saveError) throw saveError;
    saved.push(data);
  }, onClose: () => closed++ };
  let tree;
  const render = () => { activeHooks = editorHooks; tree = editorHooks.render(() => editor.type(editorProps)); return elements(tree); };
  const node = label => elements(tree).find(node => node.props.label === label || node.props.title === label);
  render();
  return { render, node, requests, usageRequests, saved, utils, hooks: editorHooks, elements: () => elements(tree),
    setSaveError: error => { saveError = error; },
    panel: value => { elements(tree).find(node => node.props.role === "tablist").props.onChange(value); render(); },
    refresh: () => node("settings.refreshModels") ?? node("settings.fetching"),
    change: (label, value) => node(label).props.onChange(value),
    save: () => node("settings.save").props.onClick(),
    back: () => node("settings.providerDialogNavigation").props.onClick(),
    text: () => JSON.stringify(tree, (_key, value) => typeof value === "function" ? undefined : value),
    get closed() { return closed; }, close() { pageHooks.unmount(); editorHooks.unmount(); } };
}

test("Astryx provider model ordering saves rapid moves and ignores retired or filtered callbacks", () => {
  const f = fixture({ type: "codex", models: ["alpha", "beta", "gamma"].map(id => ({ id })), activeModels: ["beta"] });
  try {
    const menu = f.elements().find(node => node.props.button?.label === "settings.reorderModel: alpha");
    assert.ok(menu);
    const move = menu.props.items.find(item => item.id === "up").onClick;
    move(); move(); f.save();
    assert.deepEqual(f.saved[0].modelOrder, ["alpha", "beta", "gamma"]);
    move(); assert.equal(f.saved.length, 1, "Saved editor callbacks retire");
  } finally { f.close(); }
  const filtered = fixture({ type: "codex", models: ["alpha", "beta"].map(id => ({ id })), activeModels: ["beta"] });
  try {
    const move = filtered.elements().find(node => node.props.button?.label === "settings.reorderModel: alpha").props.items.find(item => item.id === "up").onClick;
    const search = filtered.elements().find(node => node.props.onChange && node.props.placeholder === "settings.searchModels");
    assert.ok(search); search.props.onChange("alpha"); move(); filtered.save();
    assert.equal(filtered.saved[0].modelOrder, undefined);
  } finally { filtered.close(); }
});

test("Astryx request cache protocol saves the accepted selection without repaint", () => {
  const f = fixture({ type: "codex" });
  try {
    f.panel("request");
    f.change("settings.promptCacheHintMode", "openrouter-session"); f.save();
    assert.equal(f.saved[0].promptCacheHintMode, "openrouter-session");
  } finally { f.close(); }
});

test("Astryx inline model editor saves accepted capability, cache protocol and limits without repaint", () => {
  const f = fixture({ type: "codex", models: [{ id: "alias", contextWindow: 8000, maxOutputToken: 1000, ownedBy: "original" }], activeModels: ["alias"] });
  try {
    f.node("settings.modelSettings").props.onClick(); f.render();
    f.change("settings.modelInput", "text-image");
    f.change("settings.promptCacheHintModelOverride", "none");
    const limit = f.elements().find(node => node.props.label === "settings.contextWindow" && node.props.onChange);
    limit.props.onChange("32000");
    const saves = f.elements().filter(node => node.props.label === "settings.save");
    assert.equal(saves.length, 2);
    saves[0].props.onClick(); saves[1].props.onClick();
    assert.equal(f.saved[0].models[0].contextWindow, 32000);
    assert.deepEqual(f.saved[0].models[0].inputModalities, ["text", "image"]);
    assert.equal(f.saved[0].models[0].promptCacheHintMode, "none");
    assert.equal(f.saved[0].models[0].ownedBy, "original");
  } finally { f.close(); }
});

test("Astryx provider Save commits its open model draft without requiring a separate model Save", () => {
  const f = fixture({ type: "codex", models: [{ id: "alias", contextWindow: 32000, maxOutputToken: 8000, limitsSource: "provider" }], activeModels: ["alias"] });
  try {
    f.node("settings.modelSettings").props.onClick(); f.render();
    f.change("settings.contextWindow", "64000");
    f.change("settings.maxOutputToken", "16000");
    f.change("settings.modelCostInput", "1.5");
    f.change("settings.modelInput", "text-image");
    f.change("settings.promptCacheHintModelOverride", "none");
    f.elements().filter(node => node.props.label === "settings.save").at(-1).props.onClick();
    const model = f.saved[0].models[0];
    assert.equal(model.contextWindow, 64000);
    assert.equal(model.maxOutputToken, 16000);
    assert.equal(model.cost.input, 1.5);
    assert.equal(model.limitsSource, "user");
    assert.deepEqual(model.inputModalities, ["text", "image"]);
    assert.equal(model.promptCacheHintMode, "none");
  } finally { f.close(); }
});

test("Astryx model navigation preserves accepted edits and rejects invalid drafts before switching or saving", () => {
  const f = fixture({ type: "codex", models: ["alpha", "beta"].map(id => ({ id, contextWindow: 32000, maxOutputToken: 8000, limitsSource: "provider" })), activeModels: ["alpha", "beta"], modelOrder: ["alpha", "beta"] });
  try {
    const buttons = () => f.elements().filter(node => node.props.label === "settings.modelSettings" && node.props.onClick);
    buttons()[0].props.onClick(); f.render();
    const switchModel = buttons()[1].props.onClick;
    f.change("settings.contextWindow", "0");
    switchModel(); f.elements().filter(node => node.props.label === "settings.save").at(-1).props.onClick();
    assert.equal(f.saved.length, 0);
    f.render();
    assert.equal(f.node("settings.contextWindow").props.value, "0", "Invalid model draft stays open for correction");
    f.change("settings.contextWindow", "64000");
    switchModel(); f.render();
    assert.equal(f.node("settings.contextWindow").props.value, "32000", "The second model has its own parameter draft");
    f.change("settings.maxOutputToken", "12000");
    f.elements().filter(node => node.props.label === "settings.save").at(-1).props.onClick();
    assert.deepEqual(f.saved[0].models.map(model => [model.id, model.contextWindow, model.maxOutputToken]),
      [["alpha", 64000, 8000], ["beta", 32000, 12000]]);
  } finally { f.close(); }
});

test("Astryx cancelling a model draft discards it before the provider Save", () => {
  const f = fixture({ type: "codex", models: [{ id: "alias", contextWindow: 32000, maxOutputToken: 8000, limitsSource: "provider" }], activeModels: ["alias"] });
  try {
    f.node("settings.modelSettings").props.onClick(); f.render();
    f.change("settings.contextWindow", "64000");
    f.node("settings.cancel").props.onClick(); f.render(); f.save();
    assert.equal(f.saved[0].models[0].contextWindow, 32000);
    assert.equal(f.saved[0].models[0].limitsSource, "provider");
  } finally { f.close(); }
});

test("reopening a Gemini editor preserves saved model limits, pricing, capability and ordering through catalog refresh", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const configured = { id: "gemini-alias", contextWindow: 32000, maxOutputToken: 8000, limitsSource: "user", ownedBy: "original",
    cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 }, inputModalities: ["text"] };
  const f = fixture({ type: "gemini", models: [configured], activeModels: [configured.id], modelOrder: [configured.id] });
  try {
    f.refresh().props.onClick();
    f.requests[0].resolve([{ ...f.utils.createDraftModelConfig("gemini", configured.id), limitsSource: "provider", contextWindow: 1000000, maxOutputToken: 64000, ownedBy: "refreshed" }]);
    await settle(); f.render(); f.save();
    const saved = f.saved[0].models[0];
    assert.equal(saved.contextWindow, configured.contextWindow);
    assert.equal(saved.maxOutputToken, configured.maxOutputToken);
    assert.equal(saved.limitsSource, "user");
    assert.deepEqual(saved.cost, configured.cost);
    assert.deepEqual(saved.inputModalities, ["text"]);
    assert.equal(saved.ownedBy, "refreshed");
    assert.deepEqual(f.saved[0].modelOrder, [configured.id]);
  } finally { f.close(); }
});

test("Astryx model edits keep newly discovered limits unless that individual limit was changed", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const field of [null, "contextWindow", "maxOutputToken"]) {
    const initial = { id: "gemini-alias", contextWindow: 32000, maxOutputToken: 8000, limitsSource: "provider" };
    const f = fixture({ type: "gemini", models: [initial], activeModels: [initial.id] });
    try {
      f.node("settings.modelSettings").props.onClick(); f.render();
      f.change("settings.modelInput", "text");
      f.change("settings.modelCostInput", "1.5");
      if (field) f.change(`settings.${field}`, field === "contextWindow" ? "48000" : "16000");
      f.refresh().props.onClick();
      f.requests[0].resolve([{ ...initial, contextWindow: 64000, maxOutputToken: 24000, ownedBy: "fresh" }]);
      await settle(); f.render();
      const saves = f.elements().filter(node => node.props.label === "settings.save");
      saves[0].props.onClick(); saves[1].props.onClick();
      const model = f.saved[0].models[0];
      assert.equal(model.contextWindow, field === "contextWindow" ? 48000 : 64000);
      assert.equal(model.maxOutputToken, field === "maxOutputToken" ? 16000 : 24000);
      assert.equal(model.limitsSource, field ? "user" : "provider");
      assert.equal(model.cost.input, 1.5);
      assert.deepEqual(model.inputModalities, ["text"]);
      assert.equal(model.ownedBy, "fresh");
    } finally { f.close(); }
  }
});

test("accepted provider credentials retire an older model reply before the next render", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const oldRefresh = f.refresh().props.onClick;
    oldRefresh();
    f.change("API Key", "new-key");
    f.requests[0].resolve([f.utils.createDraftModelConfig("claude_code", "old-model")]);
    await settle(); f.render();
    oldRefresh();
    assert.equal(f.requests.length, 1, "A retired refresh callback cannot issue a request with old credentials");
    f.refresh().props.onClick(); f.render();
    assert.equal(f.requests[1].args[2], "new-key");
    f.requests[1].resolve([f.utils.createDraftModelConfig("claude_code", "new-model")]);
    await settle(); f.render(); f.save();
    assert.deepEqual(f.saved[0].models.map(model => model.id), ["new-model"]);
  } finally { f.close(); }
});

test("manual model refresh is synchronous, cancels its scheduled duplicate and keeps newer loading state", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const refresh = f.refresh().props.onClick;
    refresh(); refresh();
    assert.equal(f.requests.length, 1, "Two taps before repaint share one model request");
    t.mock.timers.tick(900); await settle();
    assert.equal(f.requests.length, 1, "Manual refresh cancels the pending automatic duplicate");
    f.change("modal-baseurl", "https://new.test/v1"); f.render();
    f.refresh().props.onClick(); f.render();
    f.requests[0].reject(new Error("Old endpoint failure")); await settle(); f.render();
    assert.equal(f.refresh().props.isLoading, true);
    assert.ok(!f.text().includes("Old endpoint failure"));
    f.requests[1].resolve([]); await settle(); f.render();
    assert.equal(f.refresh().props.isLoading, false);
  } finally { f.close(); }
});

test("leaving a provider editor retires accepted replies, callbacks and scheduled discovery", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const oldRefresh = f.refresh().props.onClick;
    oldRefresh(); f.back();
    assert.equal(f.closed, 1);
    oldRefresh();
    f.requests[0].resolve([f.utils.createDraftModelConfig("claude_code", "late-model")]);
    await settle(); t.mock.timers.tick(900); await settle(); f.render();
    assert.equal(f.requests.length, 1);
    assert.ok(!f.text().includes("late-model"));
  } finally { f.close(); }
});
test("automatic discovery still retries after a current failure and accepts whitespace-only credential edits", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    t.mock.timers.tick(899); assert.equal(f.requests.length, 0);
    t.mock.timers.tick(1); assert.equal(f.requests.length, 1);
    f.requests[0].reject(new Error("Current authentication failure")); await settle(); f.render();
    assert.ok(f.text().includes("Current authentication failure"));
    assert.equal(f.refresh().props.isLoading, false);
    f.refresh().props.onClick(); assert.equal(f.requests.length, 2);
    f.change("API Key", " old-key "); f.render();
    f.requests[1].resolve([f.utils.createDraftModelConfig("claude_code", "retired-model")]);
    await settle(); t.mock.timers.tick(900); f.render();
    assert.equal(f.requests.length, 3, "Normalized-equivalent edits must still permit a fresh request");
    assert.equal(f.requests[2].args[2], "old-key");
    f.requests[2].resolve([]); await settle(); f.render(); f.save();
    assert.deepEqual(f.saved[0].models, []);
  } finally { f.close(); }
});

test("models endpoint, proxy, custom headers and auth method retire their previous discovery", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ customHeaders: [{ key: "X-Trace", value: "first" }] });
  try {
    f.refresh().props.onClick();
    f.change("settings.providerModelsUrl", "https://models.test/catalog");
    f.requests[0].resolve([f.utils.createDraftModelConfig("claude_code", "old-endpoint")]);
    await settle(); f.render(); f.refresh().props.onClick();
    assert.equal(f.requests[1].args[3].modelsUrl, "https://models.test/catalog");
    f.panel("request");
    f.elements().find(node => node.props.ariaLabel === "settings.providerUseSystemProxy").props.onCheckedChange(true);
    f.requests[1].reject(new Error("Old proxy failure")); await settle(); f.render(); f.panel("general");
    f.refresh().props.onClick(); assert.equal(f.requests[2].args[3].useSystemProxy, true);
    f.panel("request"); f.change("settings.customHeaderValue", "second");
    f.requests[2].resolve([f.utils.createDraftModelConfig("claude_code", "old-header")]);
    await settle(); f.render(); f.panel("general"); f.refresh().props.onClick();
    assert.equal(f.requests[3].args[3].customHeaders[0].value, "second");
    f.node("settings.providerAuthToken").props.onPressedChange(true);
    f.requests[3].resolve([f.utils.createDraftModelConfig("claude_code", "old-auth")]);
    await settle(); f.render(); f.refresh().props.onClick();
    assert.equal(f.requests[4].args[3].authMode, "oauth-token");
    f.requests[4].resolve([f.utils.createDraftModelConfig("claude_code", "current")]);
    await settle(); f.render(); f.save();
    assert.deepEqual(f.saved[0].models.map(model => model.id), ["current"]);
    assert.equal(f.saved[0].customHeaders[0].value, "second");
    assert.ok(!f.text().includes("Old proxy failure"));
  } finally { f.close(); }
});

test("clearing credentials blocks retired discovery without blocking later valid credentials", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const retired = f.refresh().props.onClick; retired(); f.change("API Key", "");
    f.requests[0].resolve([f.utils.createDraftModelConfig("claude_code", "wrong")]);
    await settle(); f.render(); retired(); t.mock.timers.tick(900);
    assert.equal(f.requests.length, 1);
    f.change("API Key", "replacement"); f.render(); t.mock.timers.tick(900);
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve([]); await settle(); f.render(); f.save();
    assert.deepEqual(f.saved[0].models, []);
  } finally { f.close(); }
});

test("discovery preserves manual model limits and activation changed while the request is pending", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ models: [{ id: "existing-model", contextWindow: 123456, maxOutputToken: 4096, limitsSource: "user" }] });
  try {
    f.refresh().props.onClick();
    f.node("settings.manualAddModel").props.onClick(); f.render();
    f.change("settings.modelName", "manual-model"); f.render();
    const name = f.node("settings.modelName");
    name.props.onKeyDown({ key: "Enter" }); f.render();
    f.requests[0].resolve([
      f.utils.createDraftModelConfig("claude_code", "discovered-model"),
      { ...f.utils.createDraftModelConfig("claude_code", "existing-model"), contextWindow: 200000, limitsSource: "provider" },
    ]);
    await settle(); f.render(); f.save();
    assert.deepEqual(f.saved[0].models.map(model => model.id), ["discovered-model", "existing-model", "manual-model"]);
    assert.equal(f.saved[0].models.find(model => model.id === "existing-model").contextWindow, 123456);
    assert.equal(f.saved[0].models.find(model => model.id === "existing-model").maxOutputToken, 4096);
    assert.deepEqual(f.saved[0].activeModels, ["manual-model"]);
  } finally { f.close(); }
});

test("effect cleanup and replay discard old discovery and restart a usable editor", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.refresh().props.onClick();
    f.hooks.replayEffects(); f.render();
    f.requests[0].reject(new Error("Retired replay error")); await settle(); f.render();
    assert.ok(!f.text().includes("Retired replay error"));
    assert.equal(f.refresh().props.isLoading, false);
    t.mock.timers.tick(900); assert.equal(f.requests.length, 2);
    f.requests[1].resolve([f.utils.createDraftModelConfig("claude_code", "replayed")]);
    await settle(); f.render(); f.save();
    assert.deepEqual(f.saved[0].models.map(model => model.id), ["replayed"]);
    const retired = f.refresh().props.onClick; retired(); t.mock.timers.tick(900);
    assert.equal(f.requests.length, 2, "Saved editors no longer issue model requests");
  } finally { f.close(); }
});

test("Astryx usage test reads accepted script before repaint and rejects duplicate taps", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.panel("usage"); f.change("settings.usage.mode", "custom"); f.render();
    const test = f.node("settings.usage.test").props.onClick;
    f.change("settings.usage.script", "final accepted script");
    test(); test();
    assert.equal(f.usageRequests.length, 1);
    assert.equal(f.usageRequests[0].id, "a");
    assert.equal(f.usageRequests[0].config.script, "final accepted script");
    f.usageRequests[0].resolve({ data: [], isStale: false });
    await settle(); f.render();
    assert.equal(f.node("settings.usage.test").props.isLoading, false);
    assert.ok(f.node("settings.usage.testSuccess"));
  } finally { f.close(); }
});

test("Astryx usage edits retire old success and failure without clearing a newer loading state", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.panel("usage"); f.change("settings.usage.mode", "custom"); f.render();
    const oldTest = f.node("settings.usage.test").props.onClick;
    oldTest();
    f.change("settings.usage.script", "replacement script");
    oldTest();
    assert.equal(f.usageRequests.length, 2);
    assert.equal(f.usageRequests[1].config.script, "replacement script");
    f.usageRequests[0].reject(Error("retired quota error"));
    await settle(); f.render();
    assert.equal(f.node("settings.usage.test").props.isLoading, true);
    assert.ok(!f.text().includes("retired quota error"));
    f.usageRequests[1].resolve({ data: [{ remaining: 5 }], isStale: false });
    await settle(); f.render();
    assert.ok(f.node("settings.usage.testSuccess"));
    f.change("settings.usage.timeout", 12);
    assert.ok(!f.render().some(node => node.props.label === "settings.usage.testSuccess" || node.props.title === "settings.usage.testSuccess"));
    f.node("settings.usage.test").props.onClick();
    f.change("settings.usage.mode", "coding-plan");
    f.usageRequests[2].resolve({ data: [], isStale: false });
    await settle(); f.render();
    assert.ok(!f.node("settings.usage.testSuccess"));
  } finally { f.close(); }
});

test("Astryx usage tests retire on accepted connection edits and remain retryable after a current failure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.panel("usage"); f.node("settings.usage.test").props.onClick();
    f.panel("general"); f.change("API Key", "replacement-key");
    f.usageRequests[0].resolve({ data: [], isStale: false });
    await settle(); f.panel("usage");
    assert.ok(!f.node("settings.usage.testSuccess"));
    f.node("settings.usage.test").props.onClick();
    f.usageRequests[1].reject(Error("current quota error"));
    await settle(); f.render();
    assert.ok(f.node("current quota error"));
    assert.equal(f.node("settings.usage.test").props.isLoading, false);
    f.node("settings.usage.test").props.onClick();
    f.usageRequests[2].resolve({ data: [], isStale: false });
    await settle(); f.render();
    assert.ok(!f.node("current quota error"));
    assert.ok(f.node("settings.usage.testSuccess"));
  } finally { f.close(); }
});

test("Astryx leaving, saving and effect replay retire usage tests and their callbacks", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const exit of ["back", "save", "replay"]) {
    const f = fixture();
    try {
      f.panel("usage");
      f.change("settings.usage.mode", "custom"); f.render();
      const test = f.node("settings.usage.test").props.onClick;
      test(); f.change("settings.usage.script", "saved latest script");
      if (exit === "back") f.back();
      else if (exit === "save") {
        f.save();
        assert.equal(f.saved[0].usageQuery.script, "saved latest script");
      } else { f.hooks.replayEffects(); f.render(); }
      f.usageRequests[0].reject(Error("retired leaving error"));
      await settle(); f.render();
      assert.ok(!f.node("retired leaving error"));
      test();
      assert.equal(f.usageRequests.length, 1, "Retired test callbacks cannot restart a closed/replayed editor");
      if (exit === "replay") {
        f.node("settings.usage.test").props.onClick();
        assert.equal(f.usageRequests.length, 2);
        f.usageRequests[1].resolve({ data: [], isStale: false }); await settle(); f.render();
        assert.ok(f.node("settings.usage.testSuccess"));
      }
    } finally { f.close(); }
  }
});

test("Astryx a failed save keeps the editor usable and a successful save retires duplicate actions", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.panel("usage"); f.change("settings.usage.mode", "custom"); f.render();
    const save = f.node("settings.save").props.onClick;
    const back = f.node("settings.providerDialogNavigation").props.onClick;
    const probe = f.node("settings.usage.test").props.onClick;
    f.change("settings.usage.script", "latest script after failed save");
    f.setSaveError(Error("Persistence failed"));
    assert.throws(save, /Persistence failed/);
    probe();
    assert.equal(f.usageRequests.length, 1);
    f.usageRequests[0].reject(Error("Current test failed")); await settle(); f.render();
    assert.ok(f.node("Current test failed"));
    f.setSaveError(null); save(); save(); back(); probe();
    assert.equal(f.saved.length, 1);
    assert.equal(f.saved[0].usageQuery.script, "latest script after failed save");
    assert.equal(f.closed, 0, "Retired back actions do not close a newer editor");
    assert.equal(f.usageRequests.length, 1);
  } finally { f.close(); }
});

test("Astryx effect replay retires old save and back actions while keeping fresh actions usable", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const save = f.node("settings.save").props.onClick;
    const back = f.node("settings.providerDialogNavigation").props.onClick;
    f.hooks.replayEffects(); f.render(); save(); back();
    assert.equal(f.saved.length, 0);
    assert.equal(f.closed, 0);
    f.save();
    assert.equal(f.saved.length, 1);
  } finally { f.close(); }
});
