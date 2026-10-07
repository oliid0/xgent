import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const base = createTsModuleLoader();
const { normalizeSettings } = base.loadModule("src/lib/settings/index.ts");
const { translations } = base.loadModule("src/i18n/config.ts");
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const t = key => { assert.ok(translations["zh-CN"][key], key); assert.ok(translations["en-US"][key], key); return key; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

function browser(options = {}) {
  const hooks = createReactHookHarness(), calls = [];
  const state = { panelOpen: true, panelOpenSource: "user", panelFocusRequest: 3, initializing: false, error: null,
    sessions: [{ sessionId: "one", url: options.url ?? "https://example.test", title: "Example" }, { sessionId: "two", url: "https://other.test", title: "Other" }],
    activeSessionId: "one", busySessionIds: [] };
  const controller = {
    subscribe: () => () => {}, getSnapshot: () => state, sessionsForConversation: () => state.sessions,
    initialize: options.initialize ?? (async () => {}),
    action: options.action ?? (async (...args) => { calls.push(args); }),
    setViewport: async (...args) => { calls.push(["viewport", ...args]); },
    closePanel: () => { state.panelOpen = false; calls.push(["close"]); },
    selectSession: id => { state.activeSessionId = id; },
    newSession: async () => { calls.push(["new"]); }, closeSession: async id => { calls.push(["close-tab", id]); },
    clearError: () => { state.error = null; },
  };
  const loader = createTsModuleLoader({ mocks: {
    react: { ...hooks.react, useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    "../i18n": { useLocale: () => ({ t }) },
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile ?? false },
    "../lib/browser/browserSessionController": { browserSessionController: controller, MAX_BROWSER_SESSIONS: 16,
      HIDDEN_BROWSER_VIEWPORT: { x: 0, y: 0, width: 1, height: 1, visible: false, scaleFactor: 1 },
      normalizeBrowserAddress: text => text.trim() ? (/^https?:/.test(text.trim()) ? text.trim() : `https://${text.trim()}`) : "about:blank" },
    "../lib/browser/browserPageActions": { canOpenBrowserPage: url => /^https?:/.test(url ?? ""), runBrowserPageAction: options.pageAction ?? (async (...args) => { calls.push(["page-action", ...args]); }) },
    "./NativeSurface": { NativeSurface: "NativeSurface" }, "./nativeTheme": { createNativePresentationTheme: () => undefined },
  } });
  const { NativeBrowserPage } = loader.loadModule("src/presentation/NativeBrowserPage.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const render = () => {
    const element = hooks.render(() => NativeBrowserPage({ settings: normalizeSettings({}), tools: options.tools }));
    if (!element) return null;
    const surface = element.props;
    validatePresentationDocument({ ...surface.document, version: 1, surface: "browser", revision: 1 }, surface.handlers);
    return surface;
  };
  const action = (id, value = null, surface = render()) => {
    const handler = surface.handlers.get(id); assert.ok(handler?.enabled, id); assert.ok(handler.accepts(value), id);
    return handler.run(value);
  };
  render();
  return { state, calls, render, action, nodes: () => flatten(render().document.nodes), unmount: () => hooks.unmount() };
}

test("native browser uses the latest edit before a document rerender and Return carries the actual field draft", async () => {
  const h = browser();
  try {
    const published = h.render();
    h.action("browser-address:one", " latest.test ", published);
    await h.action("browser-go:one", null, published);
    await h.action("browser-go:one", "return.test", published);
    assert.deepEqual(h.calls, [["navigate", { url: "https://latest.test" }, { sessionId: "one" }], ["navigate", { url: "https://return.test" }, { sessionId: "one" }]]);
    assert.equal(published.handlers.get("browser-go:one").accepts(true), false);
    assert.equal(published.handlers.get("browser-address:one").accepts(null), false);
  } finally { h.unmount(); }
});

test("native browser wires desktop history, reload, devtools and conversation tabs to actual shared commands", async () => {
  const h = browser();
  try {
    for (const id of ["browser-back", "browser-forward", "browser-reload", "browser-devtools"]) await h.action(id);
    assert.deepEqual(h.calls.map(call => call[0]), ["go_back", "go_forward", "reload", "open_devtools"]);
    assert.equal(h.nodes().find(node => node.id === "browser-tab-count").label, "2/16");
    h.action("browser-tab:two"); assert.equal(h.state.activeSessionId, "two");
    assert.equal(h.nodes().find(node => node.id === "browser-address:two").value, "https://other.test");
  } finally { h.unmount(); }
});

test("a stale native address or viewport callback cannot act on a newly selected tab", async () => {
  const h = browser();
  try {
    const published = h.render(); h.state.activeSessionId = "two";
    h.action("browser-address:one", "stale.test", published);
    await h.action("browser-go:one", "stale.test", published);
    await h.action("browser-viewport:one", JSON.stringify({ x: 0, y: 0, width: 320, height: 600, visible: true }), published);
    assert.deepEqual(h.calls, []);
    assert.equal(h.nodes().find(node => node.id === "browser-address:two").value, "https://other.test");
  } finally { h.unmount(); }
});

test("rapid browser commands are locked before shared busy state rerenders", async () => {
  const pending = deferred(), calls = [];
  const h = browser({ action: async (...args) => { calls.push(args); await pending.promise; } });
  try {
    const published = h.render(); const first = h.action("browser-reload", null, published);
    await h.action("browser-back", null, published); assert.equal(calls.length, 1);
    pending.resolve(); await first;
    await h.action("browser-forward"); assert.equal(calls.length, 2);
    h.state.busySessionIds = ["one"];
    assert.equal(h.render().handlers.get("browser-reload").enabled, false);
    assert.equal(h.nodes().find(node => node.id === "browser-tab:one").status, "running");
  } finally { h.unmount(); }
});

test("browser failures keep chrome usable and can be dismissed without losing sessions", async () => {
  const h = browser({ initialize: async () => { throw Error("engine unavailable"); } });
  try {
    await settle(); assert.equal(h.nodes().find(node => node.id === "browser-error-message").label, "engine unavailable");
    h.action("browser-dismiss-error"); assert.ok(!h.nodes().some(node => node.id === "browser-error-message"));
    h.render().onError(Error("navigation failed"));
    assert.equal(h.nodes().find(node => node.id === "browser-error-message").label, "navigation failed");
    await h.action("browser-new"); assert.deepEqual(h.calls, [["new"]]);
    assert.equal(h.state.sessions.length, 2);
  } finally { h.unmount(); }
});

test("blank browser pages hide the actual viewport and retain a native start prompt on mobile", async () => {
  const h = browser({ mobile: true, url: "about:blank" });
  try {
    assert.ok(h.nodes().some(node => node.id === "browser-empty-message"));
    assert.ok(!h.nodes().some(node => node.kind === "BrowserViewport"));
    assert.equal(h.nodes().find(node => node.id === "browser-address:one").value, "");
    assert.ok(!h.render().handlers.has("browser-devtools"));
    assert.equal(h.calls[0][0], "viewport"); assert.equal(h.calls[0][2].visible, false);
    h.state.panelOpenSource = "agent"; assert.equal(h.render(), null);
  } finally { h.unmount(); }
});

test("disposed native browser callbacks cannot create new sessions or report late failures", async () => {
  const pending = deferred(); const h = browser({ initialize: () => pending.promise });
  const published = h.render(); h.unmount();
  await h.action("browser-new", null, published); assert.deepEqual(h.calls.filter(call => call[0] === "new"), []);
  pending.reject(Error("retired engine")); await settle(); published.onError(Error("retired command"));
});

test("retiring mobile user chrome hides its browser viewport when agent activity takes over", () => {
  const h = browser({ mobile: true });
  try {
    h.state.panelOpenSource = "agent"; assert.equal(h.render(), null);
    assert.equal(h.calls[0][0], "viewport"); assert.equal(h.calls[0][1], "one"); assert.equal(h.calls[0][2].visible, false);
  } finally { h.unmount(); }
});

function settingsPanel(options = {}) {
  const hooks = createReactHookHarness(), calls = [];
  const mocks = {
    react: hooks.react, "../../../i18n": { useLocale: () => ({ t }) },
    "../../../components/icons": {}, "./MobilePanelScaffold": {},
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../../lib/browser/browserSessionController": {
      browserSessionController: { configure: value => calls.push(["configure", value]), closeAllSessions: options.clear ?? (async () => calls.push(["clear"])) },
      normalizeBrowserAddress: text => text.trim() ? `https://${text.trim().replace(/^https:\/\//, "")}` : "about:blank",
    },
  };
  for (const component of ["Banner", "Button", "FormLayout", "Layout", "Switch", "Text", "TextInput"]) mocks[`@astryxdesign/core/${component}`] = {};
  const loader = createTsModuleLoader({ mocks });
  const { MobileBrowserSettingsPanel } = loader.loadModule("src/pages/chat/mobile/MobileBrowserSettingsPanel.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const props = { open: true, settings: normalizeSettings({}), onClose: () => calls.push(["close"]),
    setSettings: updater => { props.settings = updater(props.settings); } };
  const render = () => {
    const element = hooks.render(() => MobileBrowserSettingsPanel(props));
    if (!element) return null;
    validatePresentationDocument({ ...element.props.document, version: 1, surface: "browser-settings", revision: 1 }, element.props.handlers);
    return element.props;
  };
  render(); return { render, calls, props, unmount: () => hooks.unmount(), replay: () => hooks.replayEffects() };
}

test("native browser home page saves immediate edits, accepts Return and preserves other concurrent settings", async () => {
  const h = settingsPanel();
  try {
    const published = h.render(); published.handlers.get("browser-home-page").run("new.test");
    h.props.settings = { ...h.props.settings, theme: "dark" };
    published.handlers.get("browser-home-save").run(null);
    assert.equal(h.props.settings.customSettings.browser.homePage, "https://new.test"); assert.equal(h.props.settings.theme, "dark");
    published.handlers.get("browser-home-save").run("");
    assert.equal(h.props.settings.customSettings.browser.homePage, "about:blank");
    assert.equal(h.render().handlers.get("browser-home-save").accepts(3), false);
    const toggle = h.render().handlers.get("browser-automation-blocked"); toggle.run(true);
    assert.ok(h.props.settings.access.blockedLocalCapabilities.includes("browser_automation"));
    assert.ok(flatten(h.render().document.nodes).find(node => node.id === "browser-automation-blocked").text);
  } finally { h.unmount(); }
});

test("native session cleanup reports partial errors, blocks repeated clicks and ignores retired panel failures", async () => {
  const first = deferred(); let count = 0;
  const h = settingsPanel({ clear: () => { count++; return first.promise; } });
  try {
    const published = h.render(); const a = published.handlers.get("browser-clear-sessions").run(null);
    await published.handlers.get("browser-clear-sessions").run(null); assert.equal(count, 1);
    published.handlers.get("close").run(null); assert.ok(!h.calls.some(call => call[0] === "close"));
    first.reject(Error("two: engine refused")); await a;
    assert.equal(flatten(h.render().document.nodes).find(node => node.id === "browser-settings-error").label, "two: engine refused");
    assert.equal(h.render().handlers.get("browser-clear-sessions").enabled, true);
  } finally { h.unmount(); }
  const retired = deferred(); const other = settingsPanel({ clear: () => retired.promise });
  try {
    const old = other.render().handlers.get("browser-clear-sessions").run(null);
    other.props.open = false; other.render(); other.props.open = true; other.render();
    retired.reject(Error("old panel")); await old;
    assert.ok(!flatten(other.render().document.nodes).some(node => node.id === "browser-settings-error"));
    other.replay(); assert.equal(other.render().handlers.get("browser-home-save").enabled, true);
  } finally { other.unmount(); }
});


test("native browser menu uses real page actions and rejects internal, stale and retired pages", async () => {
  const h = browser();
  try {
    const published = h.render();
    await h.action("browser-copy_address"); await h.action("browser-open_external");
    assert.deepEqual(h.calls, [["page-action", "copy_address", "https://example.test"], ["page-action", "open_external", "https://example.test"]]);
    h.state.activeSessionId = "two";
    await h.action("browser-copy_address", null, published); assert.equal(h.calls.length, 2);
    h.state.sessions[1].url = "about:blank";
    assert.equal(h.render().handlers.get("browser-open_external").enabled, false);
  } finally { h.unmount(); }
  const failed = browser({ pageAction: async () => { throw Error("clipboard blocked"); } });
  try {
    await failed.action("browser-copy_address");
    assert.equal(failed.nodes().find(node => node.id === "browser-error-message").label, "browser.pageActionFailed");
  } finally { failed.unmount(); }
});

test("native new tab tools dispatch actual workspace actions while omitted tools stay absent", async () => {
  const selected = [];
  const h = browser({ url: "about:blank", tools: ["review", "terminal", "files", "side-chat"].map(id => ({ id, label: id, icon: "terminal", run: () => selected.push(id) })) });
  try {
    for (const id of ["review", "terminal", "files", "side-chat"]) await h.action(`browser-tool:${id}`);
    assert.deepEqual(selected, ["review", "terminal", "files", "side-chat"]);
    for (const id of selected) { const node = h.nodes().find(item => item.id === `browser-tool:${id}`); assert.equal(node.kind, "Button"); assert.equal(node.label, id); }
  } finally { h.unmount(); }
  const chat = browser({ url: "about:blank" });
  try { assert.ok(!chat.nodes().some(node => node.id === "browser-new-tab-tools")); }
  finally { chat.unmount(); }
});


test("native new-tab unavailable workspace actions and retired asynchronous failures stay inert", async () => {
  const selected = [];
  const disabled = browser({ url: "about:blank", tools: [{ id: "terminal", label: "Terminal", icon: "terminal", run: () => selected.push("terminal"), enabled: false }] });
  try { const handler = disabled.render().handlers.get("browser-tool:terminal"); assert.equal(handler.enabled, false); assert.equal(disabled.nodes().find(node => node.id === "browser-tool:terminal").disabled, true); assert.deepEqual(selected, []); }
  finally { disabled.unmount(); }
  const pending = deferred(), h = browser({ pageAction: () => pending.promise });
  try {
    const task = h.action("browser-copy_address"); h.state.activeSessionId = "two";
    pending.reject(Error("previous tab failure")); await task;
    assert.ok(!h.nodes().some(node => node.id === "browser-error-message"));
  } finally { h.unmount(); }
});
