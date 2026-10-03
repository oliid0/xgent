import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(options = {}) {
  const hooks = createReactHookHarness(), calls = [];
  let closes = 0, failSave = false;
  const locale = { t: key => key };
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => locale },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile ?? true },
    "../../lib/providers/usageQuery": { testProviderUsage: async (...args) => {
      calls.push(args); return options.test ? options.test(...args) : { data: [{ remaining: 42, unit: "USD" }], isStale: false };
    } },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
  } });
  const { getDefaultSettings, normalizeCustomProvider } = loader.loadModule("src/lib/settings/index.ts");
  const { NativeProviderRequestSettings } = loader.loadModule("src/pages/settings/NativeProviderRequestSettings.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  let settings = getDefaultSettings();
  settings = { ...settings, customProviders: [normalizeCustomProvider({ id: "provider", type: options.type ?? "claude_code", name: "Relay",
    baseUrl: "https://relay.test/v1", apiKey: "provider-key", models: [], activeModels: [],
    customHeaders: options.headers ?? [], promptCachingEnabled: true, usageQuery: options.usage,
  })] };
  const props = { providerId: "provider", onBack: () => { closes++; }, nativeSettingsSurfaceId: "settings-session" };
  const render = () => {
    const result = hooks.render(() => NativeProviderRequestSettings({ ...props, settings, setSettings: update => {
      if (failSave) throw new Error("save rejected"); settings = update(settings);
    } })).props;
    validatePresentationDocument({ ...result.document, version: 1, surface: "request-test", revision: 1 }, result.handlers);
    return result;
  };
  const action = (id, value = null, result = render()) => {
    const handler = result.handlers.get(id); assert.ok(handler, id); assert.ok(handler.enabled, id);
    assert.ok(handler.accepts(value), id); return handler.run(handler.normalize ? handler.normalize(value) : value);
  };
  const nodes = () => render().document.nodes.flatMap(function walk(node) { return [node, ...(node.children ?? []).flatMap(walk)]; });
  render(); return { render, action, nodes, calls, settings: () => settings, get closes() { return closes; },
    failSave: value => { failSave = value; }, unmount: () => hooks.unmount() };
}

test("native per-provider request settings save proxy, bounded retry, cache retention and final header text", () => {
  const h = harness({ mobile: false });
  assert.equal(h.render().document.formFactor, "desktop");
  h.action("provider-system-proxy", true); h.action("provider-stream-retry", "custom");
  h.action("provider-stream-retries", 25); h.action("provider-cache-retention", "long");
  h.action("provider-header-add");
  const headerKey = h.nodes().find(node => node.id.startsWith("provider-header-key:")).id;
  const headerValue = headerKey.replace("-key:", "-value:");
  const published = h.render();
  h.action(headerKey, "X-Request-ID", published); h.action(headerValue, "final-accepted-value", published);
  h.action("provider-request-save", null, published);
  const provider = h.settings().customProviders[0];
  assert.equal(provider.useSystemProxy, true); assert.deepEqual(provider.retryPolicy, { mode: "custom", maxRetries: 10 });
  assert.equal(provider.promptCachingEnabled, true); assert.equal(provider.promptCacheRetention, "long");
  assert.deepEqual(provider.customHeaders, [{ key: "X-Request-ID", value: "final-accepted-value" }]);
  assert.equal(h.closes, 1);
  published.handlers.get(headerValue).run("retired"); published.handlers.get("provider-request-save").run(null);
  assert.equal(h.closes, 1); assert.equal(h.settings().customProviders[0].customHeaders[0].value, "final-accepted-value");
  h.unmount();
});

test("native header validation preserves drafts and failed save, with stable row identities and secret visibility", () => {
  const h = harness(); h.action("provider-header-add"); h.action("provider-header-add");
  const keys = h.nodes().filter(node => node.id.startsWith("provider-header-key:")).map(node => node.id);
  const id = keys[1].split(":")[1];
  h.action(keys[0], "X-First"); h.action(keys[1], "Authorization");
  h.action("provider-header-value:" + id, "secret");
  assert.equal(h.nodes().find(node => node.id === "provider-header-value:" + id).secure, true);
  h.action("provider-header-show:" + id);
  assert.equal(h.nodes().find(node => node.id === "provider-header-value:" + id).secure, false);
  h.action("provider-request-save");
  assert.equal(h.nodes().find(node => node.id === "provider-request-error").label, "settings.customHeaderReservedTitle");
  assert.equal(h.closes, 0);
  h.action(keys[1], "X-Second"); h.action("provider-header-value:" + id, "bad\r\nvalue"); h.action("provider-request-save");
  assert.equal(h.nodes().find(node => node.id === "provider-request-error").label, "settings.invalidCustomHeaderValue");
  h.action("provider-header-remove:" + keys[0].split(":")[1]);
  h.action("provider-header-value:" + id, "recovered");
  h.failSave(true); h.action("provider-request-save");
  assert.equal(h.closes, 0); assert.equal(h.nodes().find(node => node.id === "provider-request-error").label, "save rejected");
  h.failSave(false); h.action("provider-request-save");
  assert.deepEqual(h.settings().customProviders[0].customHeaders, [{ key: "X-Second", value: "recovered" }]);
  h.unmount();
});

test("native usage exposes all five modes and preserves scripts and mode-specific credentials", () => {
  const h = harness({ type: "gemini" });
  assert.ok(!h.render().handlers.has("provider-prompt-cache"));
  h.action("provider-detail-section", "usage");
  assert.deepEqual(h.nodes().find(node => node.id === "provider-usage-mode").options.map(option => option.value),
    ["coding-plan", "balance", "general", "newapi", "custom"]);
  h.action("provider-usage-enabled", true); h.action("provider-usage-mode", "general");
  assert.equal(h.nodes().find(node => node.id === "provider-usage-script").kind, "TextArea");
  assert.equal(h.nodes().find(node => node.id === "provider-usage-script").language, "javascript");
  h.action("provider-usage-script", "general-script"); h.action("provider-usage-mode", "newapi");
  h.action("provider-usage-script", "newapi-script");
  h.action("provider-usage-access-token", "newapi-token"); h.action("provider-usage-user-id", "1001");
  h.action("provider-usage-mode", "custom"); h.action("provider-usage-script", "custom-script");
  h.action("provider-usage-mode", "general");
  assert.equal(h.nodes().find(node => node.id === "provider-usage-script").value, "general-script");
  h.action("provider-usage-mode", "coding-plan");
  for (const [id, value] of [["plan-provider", "zenmux"], ["organization", "org"], ["project", "project"], ["access-key-id", "key-id"], ["secret-access-key", "signing-secret"]]) h.action("provider-usage-" + id, value);
  h.action("provider-usage-timeout", 1); h.action("provider-request-save");
  const query = h.settings().customProviders[0].usageQuery;
  assert.equal(query.mode, "coding-plan"); assert.equal(query.enabled, true); assert.equal(query.timeoutSecs, 2);
  assert.equal(query.codingPlanProvider, "zenmux"); assert.equal(query.teamOrganizationId, "org"); assert.equal(query.teamProjectId, "project");
  assert.equal(query.accessKeyId, "key-id"); assert.equal(query.secretAccessKey, "signing-secret");
  assert.equal(query.accessToken, "newapi-token"); assert.equal(query.userId, "1001");
  assert.equal(query.scripts.custom, "custom-script");
  h.unmount();
});

test("native usage tests read final accepted script once and isolate editing, failure retry and dismissal", async () => {
  const pending = deferred(); let attempts = 0;
  const h = harness({ test: () => ++attempts === 1 ? pending.promise : Promise.resolve({ data: [], error: "quota endpoint failed", isStale: false }) });
  h.action("provider-detail-section", "usage"); h.action("provider-usage-mode", "custom");
  h.action("provider-usage-script", "old"); const published = h.render();
  h.action("provider-usage-script", "最终脚本", published);
  const reading = h.action("provider-usage-test", null, published); await h.action("provider-usage-test", null, published);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][1].script, "最终脚本");
  h.action("provider-usage-script", "replacement");
  pending.resolve({ data: [{ remaining: 42 }], isStale: false }); await reading;
  assert.ok(!h.nodes().some(node => node.id === "provider-usage-success"));
  await h.action("provider-usage-test");
  assert.equal(h.nodes().find(node => node.id === "provider-usage-error").label, "quota endpoint failed");
  assert.equal(h.render().handlers.get("provider-usage-test").enabled, true);
  const retired = h.render(); h.action("provider-request-back");
  await retired.handlers.get("provider-usage-test").run(null);
  assert.equal(h.calls.length, 2); assert.equal(h.closes, 1);
  h.unmount();
});

test("native request options follow provider cache capabilities and serialize default and disabled retries", () => {
  for (const type of ["codex", "claude_code", "gemini", "xai", "deepseek"]) {
    const h = harness({ type });
    assert.equal(h.render().handlers.has("provider-prompt-cache"), type === "codex" || type === "claude_code");
    assert.equal(h.render().handlers.has("provider-cache-retention"), type === "claude_code");
    h.action("provider-stream-retry", "off"); h.action("provider-request-save");
    assert.deepEqual(h.settings().customProviders[0].retryPolicy, { mode: "off" });
    h.unmount();
  }
  const h = harness();
  h.action("provider-stream-retry", "custom"); h.action("provider-stream-retries", 1);
  h.action("provider-stream-retry", "default"); h.action("provider-request-save");
  assert.equal(h.settings().customProviders[0].retryPolicy, undefined);
  h.unmount();
});
