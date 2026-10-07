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

function fixture() {
  const pageHooks = createReactHookHarness(), listHooks = createReactHookHarness();
  let activeHooks = pageHooks;
  const refreshed = [];
  const react = { ...React, ...Object.fromEntries(Object.keys(pageHooks.react).map(key => [key, (...args) => activeHooks.react[key](...args)])) };
  const loader = createTsModuleLoader({ mocks: {
    react,
    "@astryxdesign/core/hooks": { useMediaQuery: () => true },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/providers/usageQuery": {
      useProviderUsage: () => ({ getState: () => ({ loading: false, result: { data: [], error: "Quota temporarily unavailable" } }), refresh: async id => { refreshed.push(id); } }),
    },
    "./CodexOAuthAccounts": {}, "./ModelFailoverSection": {}, "./RetryErrorSection": {},
  } });
  const { ProvidersSection } = loader.loadModule("src/pages/settings/ProvidersSection.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const createProvider = (id, type) => ({ id, type, name: `Long provider name ${id}`, baseUrl: "https://example.test/v1", apiKey: "saved-secret", models: [], activeModels: [], useSystemProxy: true, customHeaders: [{ key: "X-Account", value: "test" }], retryPolicy: { mode: "custom", maxRetries: 3 }, usageQuery: { enabled: true } });
  const props = {
    settings: { ...getDefaultSettings(), customProviders: [createProvider("a", "claude_code"), createProvider("other", "codex"), createProvider("b", "claude_code")] },
    setSettings(update) { props.settings = update(props.settings); }, thirdPartyImportEnabled: false,
  };
  let page, list;
  const renderPage = () => {
    activeHooks = pageHooks;
    page = pageHooks.render(() => ProvidersSection(props));
    return elements(page);
  };
  const renderList = () => {
    const node = renderPage().find(node => node.type.name === "ProviderList");
    assert.ok(node, "The list view must remain reachable");
    activeHooks = listHooks;
    list = listHooks.render(() => node.type(node.props));
    return elements(list);
  };
  const rows = () => elements(list).filter(node => node.type.name === "ProviderSettingsRow");
  const action = (id, label) => {
    const row = rows().find(row => row.props.id === id);
    const confirmation = elements(row.props.actions).find(node => node.type.name === "ConfirmDeletePopover");
    return elements([row.props.reorder, row.props.actions, confirmation?.props.children(() => {})]).find(node => node.props.label === label);
  };
  const click = node => node.props.onClick({ stopPropagation() {} });
  renderList();
  return { props, refreshed, rows, action, click, renderList, renderPage, list: () => elements(list), close() { pageHooks.unmount(); listHooks.unmount(); } };
}

test("responsive provider rows preserve usage refresh, keyboard and pointer ordering, edit and confirmed delete", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const f = fixture();
  try {
    assert.deepEqual(f.rows().map(row => row.props.id), ["a", "b"]);
    const usage = f.action("a", "settings.usage.refresh");
    assert.equal(usage.type, "menuitem", "Usage refresh remains reachable in the trailing menu");
    assert.equal(f.rows()[0].props.reorder.props.label, "settings.reorderProvider: Long provider name a");
    f.click(usage);
    await Promise.resolve();
    assert.deepEqual(f.refreshed, ["a"]);
    assert.equal(f.rows().length, 2, "Refreshing usage must not open the editor");

    let prevented = 0, stopped = 0;
    f.action("a", "settings.reorderProvider: Long provider name a").props.onKeyDown({ key: "End", preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
    assert.equal(prevented, 1); assert.equal(stopped, 1);
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["b", "other", "a"]);
    f.renderList();
    assert.deepEqual(f.rows().map(row => row.props.id), ["b", "a"]);

    const list = f.list().find(node => node.props.className === "settings-provider-list");
    list.props.ref.current = { querySelectorAll: () => f.rows().map((row, index) => ({ dataset: { providerReorderId: row.props.id }, offsetHeight: 100, getBoundingClientRect: () => ({ top: index * 100 }) })) };
    let captured;
    f.action("b", "settings.reorderProvider: Long provider name b").props.onPointerDown({ button: 0, pointerId: 7, stopPropagation() {}, currentTarget: { setPointerCapture(id) { captured = id; } } });
    assert.equal(captured, 7);
    f.renderList();
    window.dispatchEvent(Object.assign(new Event("pointermove"), { clientY: 250, pointerId: 7 }));
    window.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 7 }));
    f.renderList();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["a", "other", "b"]);

    f.rows()[0].props.onEdit();
    const editor = f.renderPage().find(node => node.type.name === "ProviderEditor");
    assert.equal(editor.props.initialData.id, "a");
    const { id: _id, ...saved } = editor.props.initialData;
    editor.props.onSave({ ...saved, name: "Renamed provider" });
    f.renderList();
    const changed = f.props.settings.customProviders.find(provider => provider.id === "a");
    assert.equal(changed.name, "Renamed provider");
    assert.equal(changed.apiKey, "saved-secret");
    assert.deepEqual(changed.customHeaders, saved.customHeaders);
    assert.deepEqual(changed.retryPolicy, saved.retryPolicy);

    const confirmation = elements(f.rows()[0].props.actions).find(node => node.type.name === "ConfirmDeletePopover");
    let opened = 0;
    f.click(elements(confirmation.props.children(() => { opened++; })).find(node => node.props.label === "settings.delete"));
    assert.equal(opened, 1);
    assert.equal(f.props.settings.customProviders.length, 3, "Opening confirmation must not delete a provider");
    confirmation.props.onConfirm();
    f.renderList();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["other", "b"]);
    assert.equal(f.action("b", "settings.reorderProvider: Long provider name b").props.isDisabled, true);
  } finally {
    f.close();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test("a cancelled touch reorder restores the saved order and another pointer cannot finish the drag", () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const f = fixture();
  try {
    const list = f.list().find(node => node.props.className === "settings-provider-list");
    list.props.ref.current = { querySelectorAll: () => f.rows().map((row, index) => ({ dataset: { providerReorderId: row.props.id }, offsetHeight: 100, getBoundingClientRect: () => ({ top: index * 100 }) })) };
    const start = () => {
      f.action("a", "settings.reorderProvider: Long provider name a").props.onPointerDown({ button: 0, pointerId: 7, stopPropagation() {}, currentTarget: { setPointerCapture() {} } });
      f.renderList();
    };
    const send = (type, pointerId, clientY = 250) => window.dispatchEvent(Object.assign(new Event(type), { pointerId, clientY }));
    start(); send("pointermove", 7); f.renderList();
    assert.deepEqual(f.rows().map(row => row.props.id), ["b", "a"]);
    send("pointercancel", 7); f.renderList();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["a", "other", "b"]);
    assert.deepEqual(f.rows().map(row => row.props.id), ["a", "b"]);

    start(); send("pointermove", 9); send("pointerup", 9); f.renderList();
    assert.deepEqual(f.rows().map(row => row.props.id), ["a", "b"]);
    assert.equal(f.rows()[0].props.isSelected, true, "Another finger must not terminate the owner pointer's drag");
    send("pointermove", 7); send("pointerup", 7); f.renderList();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["b", "other", "a"]);

    start(); send("pointermove", 7, -10); f.renderList();
    f.renderPage().find(node => node.props.value === "claude_code" && node.props.onChange).props.onChange("codex");
    f.renderList();
    assert.deepEqual(f.rows().map(row => row.props.id), ["other"]);
    assert.equal(f.rows()[0].props.isSelected, false);
    send("pointerup", 7);
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["b", "other", "a"], "Changing categories cancels an unfinished reorder");
  } finally {
    f.close();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
