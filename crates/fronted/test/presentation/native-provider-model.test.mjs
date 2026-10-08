import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const allNodes = (nodes) => nodes.flatMap(node => [node, ...allNodes(node.children ?? [])]);
function harness(options = {}) {
  const hooks = createReactHookHarness(), confirmations = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile !== false },
    "../../components/astryx/useConfirmDialog": { useConfirmDialog: () => ({ dialog: null, confirm: async value => { confirmations.push(value); return options.confirm ? options.confirm(value) : true; } }) },
  } });
  const { getDefaultSettings, normalizeCustomProvider, updateCustomProviders } = loader.loadModule("src/lib/settings/index.ts");
  const { NativeProviderModelSettings } = loader.loadModule("src/pages/settings/NativeProviderModelSettings.tsx");
  const helpers = loader.loadModule("src/pages/settings/providerModelSettings.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  let settings = updateCustomProviders(getDefaultSettings(), [normalizeCustomProvider({ id: "provider", type: "codex", name: "Relay", apiKey: "secret", customHeaders: [{ key: "X-Environment", value: "staging" }], models: [{ id: "model", contextWindow: 8192, maxOutputToken: 4096, cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0.4 }, ownedBy: "original" }, { id: "other" }], activeModels: ["model", "other"] })]), backs = 0, request = 0;
  settings = { ...settings, selectedModel: { customProviderId: "provider", model: "model" } };
  const registry = createPresentationActionRegistry(), prefix = "model-settings:provider:model";
  const setSettings = update => { settings = update(settings); };
  const render = () => {
    const root = hooks.render(() => NativeProviderModelSettings({ settings, setSettings, providerId: "provider", modelId: "model", onBack: () => backs++, nativeSettingsSurfaceId: "model-editor" }));
    const surface = root.props.children[0].props;
    validatePresentationDocument({ ...surface.document, version: 1, surface: "model-editor", revision: 1 }, surface.handlers);
    registry.register("model-editor", surface.handlers); return surface;
  };
  const send = (field, value = null) => registry.dispatch({ surface: "model-editor", action: `${prefix}:${field}`, value, requestId: String(++request) });
  const dispatch = async (field, value = null) => { render(); const result = await send(field, value); render(); return result; };
  return { render, send, dispatch, confirmations, helpers, prefix, update: setSettings,
    unmount: () => hooks.unmount(), get settings() { return settings; }, get backs() { return backs; } };
}

test("native model capability uses the accepted choice before Save and automatic mode clears the override", async () => {
  for (const [mode, expected] of [["text", ["text"]], ["text-image", ["text", "image"]], ["auto", undefined]]) {
    const h = harness(); h.render();
    assert.equal((await h.send("inputMode", mode)).ok, true);
    assert.equal((await h.send("save")).ok, true);
    assert.deepEqual(h.settings.customProviders[0].models[0].inputModalities, expected);
    h.unmount();
  }
});

test("native model settings keep untouched provider limits current and only mark edited limits as user overrides", async () => {
  for (const field of [null, "contextWindow", "maxOutputToken"]) {
    const h = harness();
    h.update(previous => ({ ...previous, customProviders: previous.customProviders.map(provider => ({ ...provider,
      models: provider.models.map(model => ({ ...model, limitsSource: "provider" })) })) }));
    const surface = h.render();
    const fields = allNodes(surface.document.nodes);
    assert.equal(fields.find(node => node.id.endsWith(":contextWindow")).variant, "integer-input");
    assert.equal(fields.find(node => node.id.endsWith(":costInput")).variant, "decimal-input");
    await h.send("costInput", "1.5");
    await h.send("inputMode", "text");
    if (field) await h.send(field, field === "contextWindow" ? "48000" : "16000");
    h.update(previous => ({ ...previous, customProviders: previous.customProviders.map(provider => ({ ...provider,
      models: provider.models.map(model => ({ ...model, contextWindow: 64000, maxOutputToken: 24000, ownedBy: "fresh" })) })) }));
    assert.equal((await h.send("save")).ok, true);
    const model = h.settings.customProviders[0].models[0];
    assert.equal(model.contextWindow, field === "contextWindow" ? 48000 : 64000);
    assert.equal(model.maxOutputToken, field === "maxOutputToken" ? 16000 : 24000);
    assert.equal(model.limitsSource, field ? "user" : "provider");
    assert.equal(model.ownedBy, "fresh");
    assert.equal(model.cost.input, 1.5);
    assert.deepEqual(model.inputModalities, ["text"]);
    h.unmount();
  }
});

test("native per-model cache protocol overrides and inheritance save without overwriting refreshed metadata", async () => {
  for (const mode of ["auto", "openai-key", "openrouter-session", "none", "inherit"]) {
    const h = harness();
    h.update(previous => ({ ...previous, customProviders: previous.customProviders.map(provider => ({ ...provider,
      models: provider.models.map(model => ({ ...model, promptCacheHintMode: "openai-key" })) })) }));
    h.render();
    assert.equal((await h.send("cacheHint", mode)).ok, true);
    h.update(previous => ({ ...previous, customProviders: previous.customProviders.map(provider => ({ ...provider,
      models: provider.models.map(model => ({ ...model, ownedBy: "fresh-catalog" })) })) }));
    assert.equal((await h.send("save")).ok, true);
    assert.equal(h.settings.customProviders[0].models[0].promptCacheHintMode, mode === "inherit" ? undefined : mode);
    assert.equal(h.settings.customProviders[0].models[0].ownedBy, "fresh-catalog");
    h.unmount();
  }
});

test("native model editor uses shared limits/cost rules and preserves current provider metadata", async () => {
  for (const mobile of [true, false]) {
    const h = harness({ mobile }); const surface = h.render();
    assert.equal(surface.sessionSurface, "model-editor"); assert.equal(surface.document.formFactor, mobile ? "mobile" : "desktop");
    assert.ok(allNodes(surface.document.nodes).some(node => node.text === "settings.modelCost"));
    const shell = surface.document.nodes[0];
    assert.equal(shell.variant, "provider-model-settings");
    const footer = shell.children.find(node => node.variant === "extension-preview-footer");
    assert.deepEqual(footer.children.map(node => node.id), [h.prefix + ":delete", h.prefix + ":cancel", h.prefix + ":save"]);
    assert.ok(!allNodes(shell.children.find(node => node.variant === "extension-preview-body").children).some(node => node.id.endsWith(":save")));
    await h.dispatch("contextWindow", "32000.9"); await h.dispatch("maxOutputToken", "8000");
    await h.dispatch("costInput", "1.25"); await h.dispatch("costCacheRead", "");
    assert.equal(h.settings.customProviders[0].models[0].contextWindow, 8192, "draft does not persist before Save");
    h.update(previous => ({ ...previous, customProviders: previous.customProviders.map(provider => ({ ...provider, models: provider.models.map(model => ({ ...model, ownedBy: "refreshed" })) })) }));
    assert.equal((await h.dispatch("save")).ok, true);
    const provider = h.settings.customProviders[0], model = provider.models[0];
    assert.equal(model.contextWindow, 32000); assert.equal(model.maxOutputToken, 8000);
    assert.equal(model.limitsSource, "user"); assert.equal(model.ownedBy, "refreshed");
    assert.deepEqual(model.cost, { input: 1.25, output: 2, cacheRead: 0, cacheWrite: 0.4 });
    assert.equal(provider.apiKey, "secret"); assert.deepEqual(provider.customHeaders, [{ key: "X-Environment", value: "staging" }]);
    assert.deepEqual(h.settings.selectedModel, { customProviderId: "provider", model: "model" }); assert.equal(h.backs, 1); h.unmount();
  }
});

test("invalid edits block Save, including an accepted edit before the next native document render", async () => {
  const h = harness(); h.render();
  assert.equal((await h.send("contextWindow", "0")).ok, true);
  assert.equal((await h.send("save")).ok, false);
  assert.equal(h.settings.customProviders[0].models[0].contextWindow, 8192);
  let surface = h.render(); assert.equal(surface.handlers.get(`${h.prefix}:save`).enabled, false);
  assert.ok(allNodes(surface.document.nodes).some(node => node.id.endsWith(":invalid")));
  await h.dispatch("contextWindow", "1000"); await h.dispatch("costOutput", "-1");
  assert.equal((await h.dispatch("save")).ok, false);
  await h.dispatch("costOutput", "NaN"); assert.equal((await h.dispatch("save")).ok, false);
  await h.dispatch("back"); assert.equal(h.backs, 1); assert.equal(h.settings.customProviders[0].models[0].contextWindow, 8192); h.unmount();
});

test("clearing all custom model costs restores catalog fallback while shared invalid drafts never mutate settings", async () => {
  const h = harness(); h.render();
  const original = h.settings, model = original.customProviders[0].models[0];
  assert.equal(h.helpers.applyModelEdit(original, "provider", { ...h.helpers.createModelEditDraft(model), maxOutputToken: "Infinity" }), original);
  for (const field of ["costInput", "costOutput", "costCacheRead", "costCacheWrite"]) await h.dispatch(field, "");
  await h.dispatch("save"); assert.equal(h.settings.customProviders[0].models[0].cost, undefined); h.unmount();
});

test("confirmed deletion removes model and active/selected references through actual settings normalization", async () => {
  const h = harness(); h.render(); await h.dispatch("delete");
  assert.equal(h.confirmations[0].tone, "destructive");
  assert.deepEqual(h.settings.customProviders[0].activeModels, ["other"]);
  assert.ok(!h.settings.customProviders[0].models.some(model => model.id === "model"));
  assert.equal(h.settings.selectedModel, undefined); assert.equal(h.backs, 1); h.unmount();
});

test("cancelled, duplicate and retired delete confirmations cannot delete a model", async () => {
  const cancelled = harness({ confirm: async () => false }); cancelled.render(); await cancelled.dispatch("delete");
  assert.equal(cancelled.settings.customProviders[0].models.length, 2); assert.equal(cancelled.backs, 0); cancelled.unmount();
  for (const retire of ["back", "unmount"]) {
    const answer = deferred(), h = harness({ confirm: () => answer.promise }); h.render();
    const pending = h.send("delete"); await Promise.resolve(); await Promise.resolve();
    await h.send("delete"); assert.equal(h.confirmations.length, 1);
    if (retire === "back") await h.send("back"); else h.unmount();
    answer.resolve(true); await pending;
    assert.equal(h.settings.customProviders[0].models.length, 2); if (retire === "back") h.unmount();
  }
});

test("model deleted by another view produces a recoverable empty editor and is never recreated by its old draft", () => {
  const h = harness(); h.render(); const draft = h.helpers.createModelEditDraft(h.settings.customProviders[0].models[0]);
  h.update(previous => h.helpers.removeProviderModel(previous, "provider", "model"));
  const surface = h.render(); assert.ok(allNodes(surface.document.nodes).some(node => node.id.endsWith(":missing")));
  assert.ok(!surface.handlers.has(`${h.prefix}:save`)); assert.equal(h.helpers.applyModelEdit(h.settings, "provider", draft), h.settings); h.unmount();
});
