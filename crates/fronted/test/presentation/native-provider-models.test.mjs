import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(fetch) {
  const hooks = createReactHookHarness();
  const utils = createTsModuleLoader().loadModule("src/pages/settings/providerUtils.ts");
  const calls = [], edits = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../pages/settings/providerUtils": { ...utils, fetchModelsFromApi: async (...args) => {
      calls.push(args); return fetch ? fetch(...args) : [utils.createDraftModelConfig("codex", "new-model")];
    } },
  } });
  const { getDefaultSettings, normalizeCustomProvider } = loader.loadModule("src/lib/settings/index.ts");
  const { useNativeProviderModels } = loader.loadModule("src/presentation/nativeProviderModels.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  let settings = getDefaultSettings();
  const provider = normalizeCustomProvider({ id: "one", type: "codex", name: "One", baseUrl: "https://one.test/v1", apiKey: "credential",
    models: ["alpha", "beta", "gamma"].map(id => id === "beta"
      ? { ...utils.createDraftModelConfig("codex", id), contextWindow: 16384, maxOutputToken: 1024, limitsSource: "user" }
      : utils.createDraftModelConfig("codex", id)), activeModels: ["beta"] });
  settings = { ...settings, customProviders: [provider], selectedModel: { customProviderId: "one", model: "beta" } };
  const props = { providerId: "one", enabled: true, busy: false };
  const render = () => {
    const result = hooks.render(() => useNativeProviderModels({ settings, setSettings: update => { settings = update(settings); } },
      settings.customProviders.find(item => item.id === props.providerId), props.enabled, props.busy,
      run => run(), id => edits.push(id), key => key));
    validatePresentationDocument({ version: 1, surface: "provider-test", revision: 1, mode: "sheet",
      nodes: [...(result.fetch ? [result.fetch] : []), ...result.nodes] }, result.handlers);
    return result;
  };
  const action = (id, value = null, result = render()) => {
    const handler = result.handlers.get(id); assert.ok(handler, id); assert.ok(handler.enabled, id); return handler.run(value);
  };
  const nodes = () => render().nodes.flatMap(function walk(node) { return [node, ...(node.children ?? []).flatMap(walk)]; });
  render(); return { render, action, nodes, calls, edits, props, settings: () => settings,
    provider: () => settings.customProviders.find(item => item.id === props.providerId),
    addProvider: () => { settings = { ...settings, customProviders: [...settings.customProviders, { ...provider, id: "two", name: "Two" }] }; },
    patchProvider: patch => { settings = { ...settings, customProviders: settings.customProviders.map(item => item.id === props.providerId ? { ...item, ...patch } : item) }; },
    unmount: () => hooks.unmount(), replay: () => hooks.replayEffects() };
}

test("native provider models share ordering, filtered bulk selection, enable states and token limits", () => {
  const h = harness();
  assert.deepEqual(h.nodes().filter(node => node.variant === "provider-model-row").map(node => node.id),
    ["model-row:one:beta", "model-row:one:gamma", "model-row:one:alpha"]);
  const limits = h.nodes().find(node => node.id === "model-limits:one:alpha");
  assert.match(limits.text, /ctx.*out/); assert.match(limits.accessibilityLabel, /settings.contextWindow.*settings.maxOutputToken/);
  h.action("model-bulk-mode");
  const published = h.render();
  // Select all must use the search text accepted before the next publication.
  h.action("model-search", "ALPHA", published); h.action("model-select-all", null, published);
  h.action("model-bulk-enable");
  assert.deepEqual(new Set(h.provider().activeModels), new Set(["alpha", "beta"]));
  assert.equal(h.nodes().find(node => node.id === "model-select:one:alpha").selected, true);
  h.action("model-search-clear"); h.action("model-select:one:beta"); h.action("model-bulk-disable");
  assert.deepEqual(h.provider().activeModels, []);
  h.action("model-bulk-mode");
  assert.ok(h.render().handlers.has("model:one:gamma"));
  h.action("model-search", "missing");
  assert.equal(h.nodes().find(node => node.id === "models-empty").label, "settings.noMatchingModels");
  h.unmount();
});

test("native provider manual additions use accepted Unicode text, deduplicate, edit and remove models", () => {
  const h = harness();
  h.action("model-id", "old");
  const published = h.render();
  h.action("model-id", " 最终模型 🔑 ", published); h.action("add-model", null, published);
  assert.ok(h.provider().models.some(model => model.id === "最终模型 🔑"));
  assert.ok(!h.provider().models.some(model => model.id === "old"));
  assert.equal(h.nodes().find(node => node.id === "model-id").value, "");
  assert.equal(h.settings().selectedModel.model, "beta");
  h.action("model-id", "最终模型 🔑"); h.action("add-model");
  assert.equal(h.provider().models.filter(model => model.id === "最终模型 🔑").length, 1);
  h.action("model-edit:one:最终模型 🔑"); assert.deepEqual(h.edits, ["最终模型 🔑"]);
  h.action("model-delete:one:最终模型 🔑");
  assert.ok(!h.provider().models.some(model => model.id === "最终模型 🔑"));
  assert.ok(!h.provider().activeModels.includes("最终模型 🔑"));
  h.unmount();
});

test("native model refresh preserves enabled choices and custom limits, blocks duplicates and retries failure", async () => {
  const pending = deferred(); let attempts = 0;
  const utils = createTsModuleLoader().loadModule("src/pages/settings/providerUtils.ts");
  const h = harness(() => ++attempts === 1 ? pending.promise : Promise.resolve([
    { ...utils.createDraftModelConfig("codex", "alpha"), contextWindow: 777, limitsSource: "provider" },
    { ...utils.createDraftModelConfig("codex", "beta"), contextWindow: 888, maxOutputToken: 999, limitsSource: "provider" },
    utils.createDraftModelConfig("codex", "new-model"),
  ]));
  const published = h.render();
  const reading = h.action("fetch-models", null, published); await h.action("fetch-models", null, published);
  assert.equal(h.calls.length, 1);
  pending.reject(new Error("catalogue unavailable")); await assert.rejects(reading, /catalogue unavailable/);
  assert.ok(h.render().handlers.get("fetch-models").enabled);
  await h.action("fetch-models");
  assert.deepEqual(h.provider().activeModels, ["beta"]);
  assert.equal(h.provider().models.find(model => model.id === "alpha").contextWindow, 777);
  assert.equal(h.provider().models.find(model => model.id === "beta").contextWindow, 16384);
  assert.equal(h.provider().models.find(model => model.id === "beta").maxOutputToken, 1024);
  assert.ok(h.provider().models.some(model => model.id === "gamma"));
  assert.equal(h.settings().selectedModel.model, "beta");
  assert.equal(h.calls[1][3].providerConfigId, "one");
  h.unmount();
});

test("native provider callbacks and discoveries retire across route changes and preserve search through model detail", async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  h.action("model-search", "beta");
  const old = h.render(), reading = h.action("fetch-models", null, old);
  h.props.enabled = false; h.render(); h.props.enabled = true; h.render();
  assert.equal(h.nodes().find(node => node.id === "model-search").value, "beta");
  pending.resolve([]); await reading;
  const count = h.calls.length;
  old.handlers.get("model-id").run("retired"); old.handlers.get("add-model").run(null);
  await old.handlers.get("fetch-models").run(null);
  assert.equal(h.calls.length, count); assert.ok(!h.provider().models.some(model => model.id === "retired"));
  h.addProvider(); h.props.providerId = "two"; h.render();
  assert.equal(h.nodes().find(node => node.id === "model-search").value, "");
  h.replay(); h.render();
  h.action("model:two:alpha", true);
  assert.ok(h.provider().activeModels.includes("alpha"));
  const closing = h.render(); h.unmount(); closing.handlers.get("model:two:alpha").run(false);
  assert.ok(h.provider().activeModels.includes("alpha"));
});

test("native model catalogue requires the current credential and ignores a retired endpoint failure", async () => {
  const pending = deferred(); let attempt = 0;
  const h = harness(() => ++attempt === 1 ? pending.promise : Promise.resolve([]));
  const original = h.render(), reading = h.action("fetch-models", null, original);
  h.patchProvider({ baseUrl: "https://replacement.test/v1", apiKey: "" });
  assert.equal(h.render().handlers.get("fetch-models").enabled, false);
  await original.handlers.get("fetch-models").run(null);
  assert.equal(h.calls.length, 1);
  pending.reject(new Error("old endpoint failed")); await reading;
  h.patchProvider({ authMode: "oauth-managed", oauthAccountId: "" });
  assert.equal(h.render().handlers.get("fetch-models").enabled, false);
  h.patchProvider({ oauthAccountId: "account-route", apiKey: "must-not-be-forwarded" });
  await h.action("fetch-models");
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1][1], "https://replacement.test/v1");
  assert.equal(h.calls[1][2], "");
  assert.equal(h.calls[1][3].oauthAccountId, "account-route");
  assert.deepEqual(h.provider().activeModels, ["beta"]);
  h.unmount();
});
