import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

function fixture() {
  const requests = [];
  const providerUtils = createTsModuleLoader().loadModule("src/pages/settings/providerUtils.ts");
  let activeHooks;
  const children = [];
  const hooks = createReactHookHarness();
  activeHooks = hooks;
  const react = { ...React, ...Object.fromEntries(Object.keys(hooks.react).map(key => [key, (...args) => activeHooks.react[key](...args)])), useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() };
  const locale = { SUPPORTED_LOCALES: ["system", "en-US", "zh-CN"], useLocale: () => ({ t: key => key, locale: "en-US" }) };
  const mocks = {
    react, "../i18n": locale, "../../i18n": locale,
    "../pages/settings/providerUtils": { ...providerUtils, fetchModelsFromApi: (...args) => {
      let resolve, reject;
      const result = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ args, resolve, reject }); return result;
    } },
    "../../components/astryx/useConfirmDialog": { useConfirmDialog: () => ({ dialog: null, confirm: async () => true }) },
    "./NativeSurface": { NativeSurface: "NativeSurface", retainNativeSurfaceSession() {}, removeNativeSurfaceSession() {} },
    "./NativeOtherSettings": { NativeOtherSettings: "NativeOtherSettings" },
    "./nativeTheme": { createNativePresentationTheme: () => ({}) },
    "../pages/settings/useCodexOAuthAccounts": { useCodexOAuthAccounts: () => ({ status: { accounts: [] }, loaded: true, locked: false }) },
    "../../lib/providers/usageQuery": { useProviderUsage: () => ({ getState: () => ({ loading: false }), refresh() {} }) },
  };
  for (const name of ["CronSection", "SshSettingsSection", "ComputerUseSection", "GlobalShortcutsSection", "HooksSection", "SoulSection", "BackupSyncSection", "NativeProviderRuntimeSettings"])
    mocks["../pages/settings/" + name] = { [name]: name };
  mocks["../pages/settings/memory/MemoryPanel"] = { MemoryPanel: "MemoryPanel" };
  const loader = createTsModuleLoader({ mocks });
  const { NativeSettingsPage } = loader.loadModule("src/presentation/NativeSettingsPage.tsx");
  const lib = loader.loadModule("src/lib/settings/index.ts");
  let settings = { ...lib.getDefaultSettings(), customProviders: [lib.normalizeCustomProvider({ id: "existing", type: "claude_code", name: "Original", apiKey: "original-key", baseUrl: "https://original.test/v1" })] };
  let rendered, writes = 0, failed = false;
  const render = () => { activeHooks = hooks; rendered = hooks.render(() => NativeSettingsPage({ settings, setSettings: update => { if (failed) throw new Error("save rejected"); settings = update(settings); writes++; }, nativeMobile: true, initialSection: "providers", saveState: { status: "saved" }, onBack() {}, appUpdate: { result: { currentVersion: "1" } } })); return rendered; };
  const nodes = () => { const visit = values => (values ?? []).flatMap(node => [node, ...visit(node.children)]); return visit(rendered.props.document?.nodes); };
  const handler = id => { const node = nodes().find(node => node.id === id); return rendered.props.handlers.get(node?.action ?? id); };
  const action = (id, value = null) => { const result = handler(id).run(value); render(); return result; };
  const child = () => {
    const parent = rendered.props.children ?? rendered;
    assert.equal(typeof parent.type, "function");
    const childHooks = createReactHookHarness(); children.push(childHooks);
    let surface;
    const childRender = () => {
      activeHooks = childHooks;
      const root = childHooks.render(() => parent.type(parent.props));
      surface = root.props.document ? root.props : root.props.children.find(node => node?.props?.document).props;
      return surface;
    };
    const childAction = (id, value = null) => {
      const visit = values => (values ?? []).flatMap(node => [node, ...visit(node.children)]);
      const node = visit(surface.document.nodes).find(node => node.id === id);
      const result = surface.handlers.get(node?.action ?? id).run(value); childRender(); return result;
    };
    childRender(); return { render: childRender, action: childAction };
  };
  render();
  return { render, action, handler, nodes, requests, providerUtils, settings: () => settings, rendered: () => rendered, get writes() { return writes; }, failSave: value => { failed = value; }, external: update => { settings = update(settings); render(); }, child, close: () => { hooks.unmount(); for (const childHooks of children) childHooks.unmount(); } };
}

test("native Add and Back keep a new provider unsaved", () => {
  const f = fixture();
  try { f.action("add-provider"); assert.equal(f.settings().customProviders.length, 1); f.action("provider-name", "Unsaved"); f.action("back"); assert.equal(f.settings().customProviders.length, 1); assert.equal(f.writes, 0); }
  finally { f.close(); }
});

test("native editing and Back leave the saved provider unchanged", () => {
  const f = fixture();
  try { f.action("provider:existing"); f.action("provider-name", "Unsaved rename"); f.action("provider-key", "unsaved-key"); assert.equal(f.settings().customProviders[0].name, "Original"); f.action("back"); assert.equal(f.settings().customProviders[0].apiKey, "original-key"); assert.equal(f.writes, 0); }
  finally { f.close(); }
});

test("native Save validates an empty draft and commits final accepted fields once before repaint", () => {
  const f = fixture();
  try {
    f.action("add-provider");
    assert.equal(f.nodes().find(node => node.id === "provider-name").value, "");
    assert.ok(!f.nodes().some(node => node.id === "provider-delete"));
    f.action("provider-editor-save");
    assert.equal(f.writes, 0);
    assert.equal(f.nodes().find(node => node.id === "provider-editor-error").label, "settings.providerNameRequired");
    const save = f.handler("provider-editor-save");
    f.handler("provider-name").run("  Final accepted name  ");
    f.handler("provider-key").run("final-key");
    save.run(null); save.run(null); f.render();
    assert.equal(f.writes, 1);
    assert.equal(f.settings().customProviders.length, 2);
    assert.equal(f.settings().customProviders[1].name, "Final accepted name");
    assert.equal(f.settings().customProviders[1].apiKey, "final-key");
    assert.ok(f.nodes().some(node => node.id === "add-provider"));
  } finally { f.close(); }
});

test("retired native edit, cancel, back and save callbacks cannot affect a reopened provider", () => {
  const f = fixture();
  try {
    f.action("provider:existing");
    const oldName = f.handler("provider-name"), oldSave = f.handler("provider-editor-save"), oldCancel = f.handler("provider-editor-cancel"), oldBack = f.handler("back");
    f.action("provider-url", "https://unsaved.test/v1"); f.action("provider-editor-cancel");
    f.action("provider:existing");
    assert.equal(f.nodes().find(node => node.id === "provider-url").value, "https://original.test/v1");
    f.action("provider-name", "Current draft");
    oldName.run("Retired draft"); oldSave.run(null); oldCancel.run(null); oldBack.run(null); f.render();
    assert.equal(f.writes, 0);
    assert.equal(f.nodes().find(node => node.id === "provider-name").value, "Current draft");
    f.action("provider-editor-save");
    assert.equal(f.settings().customProviders[0].name, "Current draft");
  } finally { f.close(); }
});

test("native save failure keeps the same draft for retry and preserves concurrent unrelated settings", () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-key", "replacement-key");
    f.external(previous => ({ ...previous, theme: "dark", customProviders: [...previous.customProviders, { ...previous.customProviders[0], id: "other", name: "External provider" }] }));
    f.failSave(true); f.action("provider-editor-save");
    assert.equal(f.nodes().find(node => node.id === "provider-editor-error").label, "save rejected");
    assert.equal(f.settings().customProviders[0].apiKey, "original-key");
    f.failSave(false); f.action("provider-editor-save");
    assert.equal(f.settings().theme, "dark");
    assert.deepEqual(f.settings().customProviders.map(item => item.id), ["existing", "other"]);
    assert.equal(f.settings().customProviders[0].apiKey, "replacement-key");
    assert.equal(f.settings().customProviders[1].name, "External provider");
    assert.equal(f.writes, 1);
  } finally { f.close(); }
});

test("a provider removed externally cannot be resurrected by saving its native draft", () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-name", "Edited");
    f.external(previous => ({ ...previous, customProviders: [] }));
    f.action("provider-editor-save");
    assert.equal(f.nodes().find(node => node.id === "provider-editor-error").label, "settings.providerNoLongerAvailable");
    assert.equal(f.writes, 0); assert.deepEqual(f.settings().customProviders, []);
  } finally { f.close(); }
});

test("native request and usage Save updates the outer draft, and unsaved provider usage tests stay disabled", () => {
  const f = fixture();
  try {
    f.action("add-provider"); f.action("provider-name", "Request draft");
    f.action("provider-request-settings");
    assert.equal(f.rendered().props.canTestUsage, false);
    const request = f.child();
    request.action("provider-system-proxy", true);
    request.action("provider-header-add");
    let surface = request.render();
    const visit = values => (values ?? []).flatMap(node => [node, ...visit(node.children)]);
    const keyId = visit(surface.document.nodes).find(node => node.id.startsWith("provider-header-key:")).id;
    const headerId = keyId.split(":")[1];
    request.action(keyId, "X-Draft"); request.action("provider-header-value:" + headerId, "draft-value");
    request.action("provider-detail-section", "usage");
    surface = request.render();
    assert.equal(surface.handlers.get("provider-usage-test").enabled, false);
    assert.ok(visit(surface.document.nodes).some(node => node.id === "provider-usage-save-first"));
    request.action("provider-usage-mode", "custom"); request.action("provider-usage-script", "draft-script");
    request.action("provider-request-save"); f.render();
    assert.equal(f.writes, 0); assert.equal(f.settings().customProviders.length, 1);
    f.action("provider-editor-save");
    const saved = f.settings().customProviders[1];
    assert.equal(saved.useSystemProxy, true);
    assert.deepEqual(saved.customHeaders, [{ key: "X-Draft", value: "draft-value" }]);
    assert.equal(saved.usageQuery.script, "draft-script");
    assert.equal(f.writes, 1);
  } finally { f.close(); }
});

test("native model settings retain an invalid outer name and commit model limits only with outer Save", () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-name", "");
    f.action("model-id", "manual-model"); f.action("add-model");
    f.action("model-edit:existing:manual-model");
    assert.ok(f.nodes().some(node => node.id === "provider-name"), "Opening model details retains the live outer provider page");
    assert.equal(f.rendered().props.children.props.nativeSettingsSurfaceId, undefined,
      "The model uses a separately retired sheet rather than replacing the provider session");
    const model = f.child();
    const prefix = "model-settings:existing:manual-model:";
    model.action(prefix + "contextWindow", "32000");
    model.action(prefix + "maxOutputToken", "8000");
    model.action(prefix + "save"); f.render();
    assert.equal(f.writes, 0);
    assert.deepEqual(f.settings().customProviders[0].models, []);
    assert.equal(f.nodes().find(node => node.id === "provider-name").value, "");
    f.action("provider-editor-save");
    assert.equal(f.writes, 0, "Model reducers must not turn an empty name into a normalized placeholder");
    f.action("provider-name", "Configured"); f.action("provider-editor-save");
    const saved = f.settings().customProviders[0];
    assert.equal(saved.name, "Configured");
    assert.equal(saved.models[0].contextWindow, 32000);
    assert.equal(saved.models[0].maxOutputToken, 8000);
    assert.equal(saved.models[0].limitsSource, "user");
    assert.deepEqual(saved.activeModels, ["manual-model"]);
  } finally { f.close(); }
});

test("an accepted native credential change retires an older catalog before repaint", async () => {
  const f = fixture();
  try {
    f.action("provider:existing");
    const pending = f.action("fetch-models");
    assert.equal(f.requests.length, 1);
    f.handler("provider-key").run("replacement-key");
    f.requests[0].resolve([f.providerUtils.createDraftModelConfig("claude_code", "retired-model")]);
    await pending; f.render(); f.action("provider-editor-save");
    assert.equal(f.settings().customProviders[0].apiKey, "replacement-key");
    assert.deepEqual(f.settings().customProviders[0].models, []);
  } finally { f.close(); }
});

test("retired native delete confirmation cannot act on a later confirmation in the same editor", () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-delete");
    const oldConfirm = f.handler("provider-delete-confirm"), oldCancel = f.handler("provider-delete-cancel");
    f.action("provider-delete-cancel"); f.action("provider-delete");
    oldConfirm.run(null); oldCancel.run(null); f.render();
    assert.equal(f.writes, 0);
    assert.ok(f.nodes().some(node => node.id === "provider-delete-confirmation"));
    f.action("provider-delete-confirm");
    assert.equal(f.writes, 1); assert.deepEqual(f.settings().customProviders, []);
  } finally { f.close(); }
});

test("cancelling an editor discards its pending native deletion confirmation", () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-delete");
    f.action("provider-editor-cancel"); f.action("provider:existing");
    assert.ok(!f.nodes().some(node => node.id === "provider-delete-confirmation"));
    assert.equal(f.writes, 0);
  } finally { f.close(); }
});
