import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
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
  const { NativeProviderRuntimeSettings } = loader.loadModule("src/pages/settings/NativeProviderRuntimeSettings.tsx");
  const { providerRuntimeActions, runtimeModelOptions } = loader.loadModule("src/pages/settings/providerRuntimeSettings.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const { toModelValue } = loader.loadModule("src/lib/providers/llm.ts");
  let settings = updateCustomProviders(getDefaultSettings(), [
    normalizeCustomProvider({ id: "one", type: "codex", name: "First OpenAI", apiKey: "secret", models: [{ id: "model-one" }], activeModels: ["model-one"] }),
    normalizeCustomProvider({ id: "two", type: "codex", name: "Second OpenAI", models: [{ id: "model-two" }], activeModels: ["model-two"] }),
    normalizeCustomProvider({ id: "claude", type: "claude_code", name: "Anthropic", models: [{ id: "claude-model" }], activeModels: ["claude-model"] }),
  ]), backs = 0, request = 0;
  const setSettings = update => { settings = update(settings); };
  const actions = providerRuntimeActions(setSettings), registry = createPresentationActionRegistry();
  const render = () => {
    const root = hooks.render(() => NativeProviderRuntimeSettings({ settings, setSettings, providerType: "codex", onBack: () => backs++, nativeSettingsSurfaceId: "settings-runtime" }));
    const surface = root.props.children[0].props;
    validatePresentationDocument({ ...surface.document, version: 1, surface: "settings-runtime", revision: 1 }, surface.handlers);
    registry.register("settings-runtime", surface.handlers); return surface;
  };
  const dispatch = async (action, value = null) => {
    render(); const result = await registry.dispatch({ surface: "settings-runtime", action, value, requestId: String(++request) }); render(); return result;
  };
  return { render, dispatch, actions, confirmations, registry, loader, runtimeModelOptions, toModelValue,
    update: setSettings, unmount: () => hooks.unmount(), get settings() { return settings; }, get backs() { return backs; } };
}

test("native runtime settings keep surface/theme and select real title and git models, with inactive fallback", async () => {
  for (const mobile of [true, false]) {
    const h = harness({ mobile }); let s = h.render();
    assert.equal(s.sessionSurface, "settings-runtime"); assert.equal(s.document.formFactor, mobile ? "mobile" : "desktop");
    assert.equal((await h.dispatch("runtime-title-model", h.toModelValue("one", "model-one"))).ok, true);
    assert.deepEqual(h.settings.customSettings.conversationTitleModel, { customProviderId: "one", model: "model-one" });
    await h.dispatch("runtime-commit-model", h.toModelValue("two", "model-two"));
    assert.deepEqual(h.settings.customSettings.commitMessageModel, { customProviderId: "two", model: "model-two" });
    h.update(previous => ({ ...previous, customProviders: previous.customProviders.map(provider => ({ ...provider, activeModels: [] })) }));
    s = h.render(); const group = s.document.nodes.find(node => node.id === "runtime-models");
    const picker = group.children.find(node => node.id === "runtime-title-model");
    assert.equal(picker.value, h.toModelValue("one", "model-one")); assert.ok(picker.options.some(option => option.value === picker.value));
    await h.dispatch("runtime-title-model", ""); assert.equal(h.settings.customSettings.conversationTitleModel, undefined);
    await h.dispatch("runtime-back"); assert.equal(h.backs, 1); h.unmount();
  }
});

test("native failover numeric input normalizes accepted values and vendor IDs retire after selection changes", async () => {
  const h = harness(); let s = h.render();
  assert.equal(s.document.nodes.find(node => node.id === "runtime-failover").children.find(node => node.id === "runtime-cooldown:codex").kind, "NumberInput");
  let result = await h.dispatch("runtime-switches:codex", 3.8);
  assert.equal(result.ok, true); assert.equal(result.acceptedValue, 3); assert.equal(h.settings.modelFailover.codex.maxSwitches, 3);
  result = await h.dispatch("runtime-cooldown:codex", 9000); assert.equal(result.acceptedValue, 3600);
  result = await h.dispatch("runtime-threshold:codex", -4); assert.equal(result.acceptedValue, 1);
  assert.equal((await h.dispatch("runtime-switches:codex", "5")).ok, false);
  assert.equal((await h.dispatch("runtime-switches:codex", NaN)).ok, false);
  await h.dispatch("runtime-failover-enabled:codex", true);
  await h.dispatch("runtime-vendor", "claude_code"); s = h.render();
  assert.equal(s.handlers.has("runtime-switches:codex"), false);
  assert.equal((await h.dispatch("runtime-switches:codex", 8)).ok, false);
  await h.dispatch("runtime-switches:claude_code", 7);
  assert.equal(h.settings.modelFailover.codex.maxSwitches, 3); assert.equal(h.settings.modelFailover.claude_code.maxSwitches, 7);
  assert.equal(h.settings.modelFailover.codex.enabled, true); assert.equal(h.settings.modelFailover.claude_code.enabled, false); h.unmount();
});

test("rapid failover queue changes preserve both providers and real ordering, rejecting wrong-vendor additions", async () => {
  const h = harness(); const s = h.render();
  s.handlers.get("runtime-add:one").run(null); s.handlers.get("runtime-add:two").run(null);
  assert.deepEqual(h.settings.modelFailover.codex.queue, ["one", "two"]);
  h.actions.toggleQueueProvider("codex", "claude"); assert.deepEqual(h.settings.modelFailover.codex.queue, ["one", "two"]);
  let next = h.render(); assert.equal(next.handlers.get("runtime-up:one").enabled, false);
  assert.equal(next.handlers.get("runtime-down:two").enabled, false);
  await h.dispatch("runtime-up:two"); assert.deepEqual(h.settings.modelFailover.codex.queue, ["two", "one"]);
  await h.dispatch("runtime-remove:two"); assert.deepEqual(h.settings.modelFailover.codex.queue, ["one"]);
  h.actions.moveQueueProvider("codex", "one", -1); assert.deepEqual(h.settings.modelFailover.codex.queue, ["one"]);
  h.unmount();
});

test("native retry presets and custom patterns use actual shared configuration without duplicate or stale draft writes", async () => {
  const h = harness(); h.render();
  assert.equal((await h.dispatch("runtime-retry:520", true)).ok, true); assert.ok(h.settings.retryErrorSettings.presetStatusCodes.includes(520));
  assert.equal((await h.dispatch("runtime-retry:520", false)).ok, true); assert.equal(h.settings.retryErrorSettings.presetStatusCodes.includes(520), false);
  const before = h.settings; h.actions.togglePresetCode(999, true); assert.equal(h.settings, before);
  const surface = h.render(); surface.handlers.get("runtime-pattern").run(" Temporary overloaded ");
  surface.handlers.get("runtime-pattern-add").run(null); h.render();
  assert.deepEqual(h.settings.retryErrorSettings.customPatterns, ["Temporary overloaded"]);
  await h.dispatch("runtime-pattern", "temporary OVERLOADED"); await h.dispatch("runtime-pattern-add");
  assert.equal(h.settings.retryErrorSettings.customPatterns.length, 1);
  await h.dispatch("runtime-pattern-remove:0"); assert.equal(h.settings.retryErrorSettings.customPatterns.length, 0); h.unmount();
});

test("native runtime reset requires approval, serializes requests and preserves provider credentials and chosen models", async () => {
  for (const approved of [false, true]) {
    const pause = deferred(), h = harness({ confirm: () => pause.promise });
    h.actions.updateProvider("codex", { enabled: true, maxSwitches: 9 }); h.actions.addPattern("custom failure");
    h.actions.setModel("conversationTitleModel", h.toModelValue("one", "model-one"));
    const surface = h.render(), handler = surface.handlers.get("runtime-reset");
    const pending = handler.run(null); await handler.run(null);
    assert.equal(h.confirmations.length, 1); assert.equal(h.render().handlers.get("runtime-switches:codex").enabled, false);
    pause.resolve(approved); await pending; h.render();
    assert.equal(h.settings.modelFailover.codex.enabled, !approved);
    assert.equal(h.settings.retryErrorSettings.customPatterns.length, approved ? 0 : 1);
    assert.equal(h.settings.customProviders.find(provider => provider.id === "one").apiKey, "secret");
    assert.deepEqual(h.settings.customSettings.conversationTitleModel, { customProviderId: "one", model: "model-one" }); h.unmount();
  }
});

test("leaving the runtime form while reset approval is pending never applies a delayed reset", async () => {
  for (const leave of ["back", "unmount"]) {
    const pause = deferred(), h = harness({ confirm: () => pause.promise }); h.actions.updateProvider("codex", { enabled: true });
    const pending = h.render().handlers.get("runtime-reset").run(null);
    if (leave === "back") await h.dispatch("runtime-back"); else h.unmount();
    pause.resolve(true); await pending; assert.equal(h.settings.modelFailover.codex.enabled, true); h.unmount();
  }
});

test("native numeric documents reject nonfinite, missing, reversed, string and out-of-range inputs", () => {
  const { validatePresentationDocument } = createTsModuleLoader().loadModule("src/presentation/validateDocument.ts");
  const node = { id: "number", kind: "NumberInput", label: "Cooldown", value: 300, minimum: 5, maximum: 3600, step: 1 };
  for (const patch of [{ value: NaN }, { value: "300" }, { value: 4000 }, { minimum: undefined }, { maximum: Infinity }, { minimum: 5000 }, { step: 0 }]) {
    assert.throws(() => validatePresentationDocument({ version: 1, surface: "numeric", revision: 1, mode: "sheet", nodes: [{ ...node, ...patch }] }, new Map()), /Invalid native/);
  }
  assert.doesNotThrow(() => validatePresentationDocument({ version: 1, surface: "numeric", revision: 1, mode: "sheet", nodes: [node] }, new Map()));
});
