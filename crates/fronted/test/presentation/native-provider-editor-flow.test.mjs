import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

function fixture() {
  const requests = [], usageRequests = [];
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
    "../../lib/providers/usageQuery": {
      useProviderUsage: () => ({ getState: () => ({ loading: false }), refresh() {} }),
      testProviderUsage: (...args) => new Promise(resolve => usageRequests.push({ args, resolve })),
    },
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
  return { render, action, handler, nodes, requests, usageRequests, providerUtils, settings: () => settings, rendered: () => rendered, get writes() { return writes; }, failSave: value => { failed = value; }, external: update => { settings = update(settings); render(); }, child, close: () => { hooks.unmount(); for (const childHooks of children) childHooks.unmount(); } };
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
    assert.equal(f.rendered().props.document.title, "settings.addProvider");
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
    assert.equal(f.rendered().props.document.title, "settings.editProvider");
    assert.equal(f.nodes().find(node => node.id === "provider-details").label, "");
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

test("native General, Request and Usage retain one draft and commit once; new-provider testing stays disabled", () => {
  const f = fixture();
  try {
    f.action("add-provider"); f.action("provider-name", "Request draft");
    const session = f.rendered().props.sessionSurface;
    f.action("provider-editor-section", "request");
    assert.equal(f.rendered().props.sessionSurface, session);
    assert.deepEqual(f.nodes().find(node => node.id === "provider-editor-section").options.map(option => option.value), ["general", "request", "usage"]);
    assert.ok(!f.nodes().some(node => ["provider-request-back", "provider-request-save", "provider-request-settings"].includes(node.id)));
    f.action("provider-system-proxy", true);
    f.action("provider-header-add");
    const keyId = f.nodes().find(node => node.id.startsWith("provider-header-key:")).id;
    const headerId = keyId.split(":")[1];
    f.action(keyId, "X-Draft"); f.action("provider-header-value:" + headerId, "draft-value");
    f.action("provider-editor-section", "usage");
    assert.equal(f.handler("provider-usage-test").enabled, false);
    assert.ok(f.nodes().some(node => node.id === "provider-usage-save-first"));
    f.action("provider-usage-mode", "custom"); f.action("provider-usage-script", "draft-script");
    f.action("provider-editor-section", "general");
    assert.equal(f.nodes().find(node => node.id === "provider-name").value, "Request draft");
    f.action("provider-name", "Final name");
    f.action("provider-editor-section", "request");
    assert.equal(f.nodes().find(node => node.id === keyId).value, "X-Draft");
    assert.equal(f.nodes().find(node => node.id === "provider-system-proxy").value, true);
    f.action("provider-editor-section", "usage");
    assert.equal(f.nodes().find(node => node.id === "provider-usage-script").value, "draft-script");
    assert.equal(f.writes, 0); assert.equal(f.settings().customProviders.length, 1);
    f.action("provider-editor-save");
    const saved = f.settings().customProviders[1];
    assert.equal(saved.name, "Final name");
    assert.equal(saved.useSystemProxy, true);
    assert.deepEqual(saved.customHeaders, [{ key: "X-Draft", value: "draft-value" }]);
    assert.equal(saved.usageQuery.script, "draft-script");
    assert.equal(f.writes, 1);
  } finally { f.close(); }
});

test("invalid Request fields block the shared Save in every pane and Cancel discards them", () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-editor-section", "request");
    f.action("provider-header-add");
    const key = f.nodes().find(node => node.id.startsWith("provider-header-key:")).id;
    f.action(key, "Authorization");
    f.action("provider-editor-section", "general"); f.action("provider-name", "Unsaved");
    f.action("provider-editor-save");
    assert.equal(f.writes, 0);
    assert.equal(f.nodes().find(node => node.id === "provider-request-error").label, "settings.customHeaderReservedTitle");
    f.action("provider-editor-cancel"); f.action("provider:existing");
    assert.equal(f.nodes().find(node => node.id === "provider-name").value, "Original");
    f.action("provider-editor-section", "request");
    assert.ok(!f.nodes().some(node => node.id.startsWith("provider-header-key:")));
    assert.ok(!f.nodes().some(node => node.id === "provider-request-error"));
  } finally { f.close(); }
});

test("Request commit preserves the latest General OAuth account and credentials accepted before repaint", () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-type", "codex"); f.action("provider-auth", "oauth-token");
    f.action("provider-editor-section", "request"); f.action("provider-system-proxy", true);
    f.action("provider-editor-section", "general");
    const save = f.handler("provider-editor-save");
    f.handler("provider-key").run("final-token");
    f.handler("provider-oauth-account-id").run("final-account");
    save.run(null); f.render();
    assert.equal(f.writes, 1);
    const saved = f.settings().customProviders[0];
    assert.equal(saved.apiKey, "final-token");
    assert.equal(saved.useSystemProxy, true);
    assert.deepEqual(saved.customHeaders, [{ key: "chatgpt-account-id", value: "final-account" }]);
  } finally { f.close(); }
});

test("Cancel retires inline usage tests and callbacks before reopening the same provider", async () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-editor-section", "usage");
    const oldMode = f.handler("provider-usage-mode");
    const pending = f.action("provider-usage-test");
    assert.equal(f.usageRequests.length, 1);
    f.action("provider-editor-cancel"); f.action("provider:existing");
    f.action("provider-editor-section", "usage");
    oldMode.run("custom");
    f.usageRequests[0].resolve({ data: [{ remaining: 42 }], isStale: false });
    await pending; f.render();
    assert.ok(!f.nodes().some(node => node.id === "provider-usage-success" || node.id === "provider-usage-loading"));
    assert.notEqual(f.nodes().find(node => node.id === "provider-usage-mode").value, "custom");
    assert.equal(f.writes, 0);
  } finally { f.close(); }
});

test("model discovery reads the accepted Request draft and malformed headers disable a new fetch", async () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-editor-section", "request");
    f.action("provider-system-proxy", true); f.action("provider-header-add");
    const key = f.nodes().find(node => node.id.startsWith("provider-header-key:")).id;
    f.action(key, "X-Draft"); f.action(key.replace("-key:", "-value:"), "accepted");
    f.action("provider-editor-section", "general");
    const fetching = f.action("fetch-models");
    assert.equal(f.requests[0].args[3].useSystemProxy, true);
    assert.deepEqual(f.requests[0].args[3].customHeaders, [{ key: "X-Draft", value: "accepted" }]);
    f.requests[0].resolve([]); await fetching; f.render();
    assert.equal(f.writes, 0, "Discovery uses the unsaved configuration without persisting it");
    f.action("provider-editor-section", "request"); f.action(key, "Authorization");
    f.action("provider-editor-section", "general");
    assert.equal(f.handler("fetch-models").enabled, false);
    assert.equal(f.nodes().find(node => node.id === "fetch-models").disabled, true);
    f.action("provider-editor-cancel");
    assert.equal(f.settings().customProviders[0].useSystemProxy, false);
    assert.deepEqual(f.settings().customProviders[0].customHeaders, []);
  } finally { f.close(); }
});

test("General connection edits retire inline usage results before repaint and clear settled feedback", async () => {
  const f = fixture();
  try {
    f.action("provider:existing"); f.action("provider-editor-section", "usage");
    const reading = f.action("provider-usage-test");
    f.action("provider-editor-section", "general");
    f.handler("provider-key").run("accepted-before-repaint");
    f.usageRequests[0].resolve({ data: [{ remaining: 42 }], isStale: false });
    await reading; f.render(); f.action("provider-editor-section", "usage");
    assert.ok(!f.nodes().some(node => ["provider-usage-success", "provider-usage-error", "provider-usage-loading"].includes(node.id)));
    const retry = f.action("provider-usage-test");
    f.usageRequests[1].resolve({ data: [{ remaining: 24 }], isStale: false });
    await retry; f.render();
    assert.ok(f.nodes().some(node => node.id === "provider-usage-success"));
    f.action("provider-editor-section", "general");
    f.action("provider-url", "https://replacement.test/v1");
    f.action("provider-editor-section", "usage");
    assert.ok(!f.nodes().some(node => node.id === "provider-usage-success"));
    assert.equal(f.writes, 0);
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
