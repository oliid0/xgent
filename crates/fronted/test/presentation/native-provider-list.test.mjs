import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const descendants = nodes => nodes.flatMap(node => [node, ...descendants(node.children ?? [])]);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function fixture(query = async () => ({ data: [{ planName: "Plan", remaining: 0, unit: "credits" }], isStale: false })) {
  const hooks = createReactHookHarness(), edits = [], requests = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../lib/providers/usageQuery": { queryProviderUsage: async (...args) => { requests.push(args); return query(...args); } },
  } });
  const { useNativeProviderList } = loader.loadModule("src/presentation/nativeProviderList.ts");
  const { providerListDetails } = loader.loadModule("src/pages/settings/providerListDetails.ts");
  const { getDefaultSettings, normalizeCustomProvider, updateCustomProviders } = loader.loadModule("src/lib/settings/index.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const props = { settings: updateCustomProviders(getDefaultSettings(), [
    normalizeCustomProvider({ id: "a", type: "claude_code", name: "Provider A", baseUrl: "https://example.test/v1", apiKey: "saved-secret", models: [{ id: "model" }], activeModels: ["model"], useSystemProxy: true, usageQuery: { enabled: true } }),
    normalizeCustomProvider({ id: "other", type: "codex", name: "Other provider" }),
    normalizeCustomProvider({ id: "b", type: "claude_code", name: "Provider B" }),
  ]), setSettings(update) { props.settings = update(props.settings); } };
  let enabled = true, output;
  const render = () => {
    output = hooks.render(() => useNativeProviderList(props, enabled, id => edits.push(id), key => key));
    validatePresentationDocument({ version: 1, surface: "provider-list", revision: 1, mode: "sheet", title: "Providers", appearance: "light", formFactor: "mobile", nodes: output.nodes }, output.handlers);
    return output;
  };
  const run = (id, value = null) => {
    const handler = output.handlers.get(id);
    assert.ok(handler?.enabled && handler.accepts(value), `Enabled real action ${id}`);
    return handler.run(value);
  };
  render();
  return { props, edits, requests, render, run, providerListDetails, nodes: () => descendants(output.nodes),
    handler: id => output.handlers.get(id), retire() { enabled = false; render(); }, close() { hooks.unmount(); } };
}

test("native provider details retain endpoints and active models beside quota errors and zero balance", async () => {
  const f = fixture();
  try {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); f.render();
    const provider = f.props.settings.customProviders[0];
    const details = f.providerListDetails(provider, { data: [{ planName: "Plan", remaining: 0, unit: "credits" }], isStale: false }, key => key);
    assert.match(details.connection, /https:\/\/example.test\/v1/);
    assert.match(details.connection, /1 settings.activeModels/);
    assert.equal(f.nodes().find(node => node.id === "provider:a").text, details.connection);
    assert.equal(f.nodes().find(node => node.id === "provider-list-usage:a").text, details.usage);
    assert.match(details.usage, /remaining: 0 credits/);
    assert.equal(f.nodes().find(node => node.id === "provider:a").icon, "sun.max");
    const row = f.nodes().find(node => node.id === "provider-list-row:a");
    assert.ok(row.children.find(node => node.id === "provider-list-actions:a"), "Ordering has a separate leading control");
    const menu = row.children.find(node => node.id === "provider-more:a");
    assert.deepEqual(menu.children.map(node => node.id), ["provider-usage-refresh:a", "provider-edit:a", "provider-list-delete:a"], "The trailing menu retains every action");

    assert.ok(f.nodes().some(node => node.id === "provider-list-proxy:a"));
    for (const id of ["provider-edit:a", "provider-usage-refresh:a", "provider-list-delete:a"]) {
      const node = f.nodes().find(node => node.id === id);
      assert.equal(node.kind, "IconButton"); assert.equal(node.size, "large");
    }
    assert.deepEqual(f.nodes().find(node => node.id === "provider-list-actions:a").children.map(node => node.id), ["provider-up:a", "provider-down:a"]);
    const failed = f.providerListDetails(provider, { data: [], error: "Quota unreachable", isStale: false }, key => key);
    assert.equal(failed.connection, details.connection); assert.equal(failed.usage, "Quota unreachable");
    f.run("provider-edit:a"); assert.deepEqual(f.edits, ["a"]);
  } finally { f.close(); }
});

test("native direct actions and reorder menu preserve mixed vendor slots and confirmed deletion", async () => {
  const f = fixture();
  try {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); f.render();
    await f.run("provider-usage-refresh:a"); f.render();
    assert.ok(f.requests.some(([id, refresh]) => id === "a" && refresh === true));
    assert.equal(f.handler("provider-reorder").accepts('["a","a"]'), false);
    assert.equal(f.handler("provider-reorder").accepts('["a","other"]'), false);
    f.run("provider-down:a"); f.render();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["b", "other", "a"]);
    f.run("provider-reorder", '["a","b"]'); f.render();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["a", "other", "b"]);
    f.run("provider-list-delete:a"); f.render();
    assert.equal(f.props.settings.customProviders.length, 3);
    f.run("provider-list-delete-cancel"); f.render();
    assert.equal(f.props.settings.customProviders.length, 3);
    f.run("provider-list-delete:a"); f.render(); f.run("provider-list-delete-confirm"); f.render();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["other", "b"]);
  } finally { f.close(); }
});

test("a retired native delete confirmation cannot target a newly opened provider confirmation", () => {
  const f = fixture();
  try {
    f.run("provider-list-delete:a"); f.render();
    const old = f.handler("provider-list-delete-confirm");
    f.run("provider-list-delete-cancel"); f.render();
    f.run("provider-list-delete:a"); f.render();
    old.run(null); f.render();
    assert.equal(f.props.settings.customProviders.length, 3, "Even a reopened confirmation for the same provider has a new owner");
    f.run("provider-list-delete-cancel"); f.render();
    f.run("provider-list-delete:b"); f.render();
    old.run(null); f.render();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["a", "other", "b"]);
    f.run("provider-list-delete-confirm"); f.render();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["a", "other"]);
  } finally { f.close(); }
});

test("late native quota replies and retired list actions cannot affect a replacement configuration", async () => {
  const response = deferred(), f = fixture(() => response.promise);
  try {
    const oldEdit = f.handler("provider-edit:a"), oldDelete = f.handler("provider-list-delete:a");
    f.props.setSettings(previous => ({ ...previous, customProviders: previous.customProviders.map(provider => provider.id === "a" ? { ...provider, usageQuery: { ...provider.usageQuery, enabled: false }, apiKey: "new-secret" } : provider) }));
    f.render(); response.resolve({ data: [{ planName: "Old credential quota" }], isStale: false });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); f.render();
    assert.ok(!f.nodes().some(node => node.text?.includes("Old credential quota")));
    f.retire(); oldEdit.run(null); oldDelete.run(null);
    assert.deepEqual(f.edits, []); assert.equal(f.nodes().length, 0);
    assert.equal(f.props.settings.customProviders[0].apiKey, "new-secret");
  } finally { f.close(); }
});

test("native vendor navigation keeps named icon tabs and retires old row actions before repaint", () => {
  const f = fixture();
  try {
    const tabs = f.nodes().find(node => node.id === "provider-vendor");
    assert.equal(tabs.kind, "Selector");
    assert.equal(tabs.variant, "provider-vendor-tabs");
    assert.equal(tabs.label, "settings.navProviders");
    assert.deepEqual(tabs.options.map(option => option.label), ["Anthropic", "OpenAI", "Gemini", "Grok", "DeepSeek"]);
    for (const option of tabs.options) {
      const state = tabs.children.find(node => node.value === option.value);
      assert.equal(state.label, option.label);
      assert.ok(state.icon);
    }
    assert.equal(f.handler("provider-vendor").accepts("missing-vendor"), false);
    f.run("provider-list-delete:a"); f.render();
    const oldConfirm = f.handler("provider-list-delete-confirm");
    const oldEdit = f.handler("provider-edit:a"), oldMove = f.handler("provider-down:a");
    f.run("provider-vendor", "codex");
    oldConfirm.run(null); oldEdit.run(null); oldMove.run(null);
    f.render();
    assert.deepEqual(f.props.settings.customProviders.map(provider => provider.id), ["a", "other", "b"]);
    assert.deepEqual(f.edits, []);
    assert.deepEqual(f.nodes().find(node => node.id === "provider-list").children.map(node => node.value), ["other"]);
    assert.ok(!f.nodes().some(node => node.id === "provider-list-delete-confirm"));
    f.run("provider-edit:other");
    f.run("provider-vendor", "claude_code"); f.render(); f.run("provider-edit:a");
    assert.deepEqual(f.edits, ["other", "a"]);
  } finally { f.close(); }
});
