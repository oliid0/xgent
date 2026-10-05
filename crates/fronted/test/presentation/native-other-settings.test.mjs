import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const labels = Object.fromEntries(["hooks", "cron", "ssh"].map(area => [area, { title: area, description: `${area} description` }]));
const options = { title: "Other", appearance: "system", mobile: true, backLabel: "Back", labels, onBack() {}, onClose() {} };

test("Other content keeps lists together, uses current handlers and retires hidden or replaced detail actions", async () => {
  const loader = createTsModuleLoader();
  const { createNativeOtherContentStore } = loader.loadModule("src/presentation/nativeOtherContent.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const store = createNativeOtherContentStore();
  let notified = 0, invoked = "";
  store.subscribe(() => notified++);
  const content = (name, detail = false) => ({ detail, onError() {},
    document: { mode: "sheet", title: name, appearance: "system", formFactor: "mobile", dismissAction: "close",
      nodes: [{ id: "back", kind: "IconButton", label: "Back", action: "close" },
        { id: "add", kind: "Button", label: "Add", action: "add" }] },
    handlers: new Map(["close", "add"].map(id => [id, { enabled: true, accepts: v => v === null, run: () => { invoked = name + id; } }])),
  });
  const owners = { hooks: Symbol(), cron: Symbol(), ssh: Symbol() };
  for (const area of Object.keys(owners)) store.sinks[area].update(owners[area], content(area));
  let page = store.compose(options);
  validatePresentationDocument({ ...page.document, version: 1, surface: "settings:test", revision: 1 }, page.handlers);
  assert.deepEqual(page.document.nodes.filter(n => n.variant === "other-settings-area").map(n => n.label), ["hooks", "cron", "ssh"]);
  assert.equal(flatten(page.document.nodes).filter(n => n.id === "back").length, 1);
  const oldCron = page.handlers.get(flatten(page.document.nodes).find(n => n.id === "other:cron:add").action);
  const snapshot = store.getSnapshot(), count = notified;
  store.sinks.cron.update(owners.cron, { ...content("cron"), handlers: new Map([["close", content("cron").handlers.get("close")],
    ["add", { enabled: true, accepts: v => v === null, run: () => { invoked = "latest cron"; } }]]) });
  assert.equal(store.getSnapshot(), snapshot); assert.equal(notified, count);
  await oldCron.run(null); assert.equal(invoked, "latest cron");
  const detailOwner = Symbol();
  store.sinks.ssh.update(detailOwner, content("SSH editor", true));
  page = store.compose(options);
  assert.equal(page.document.title, "SSH editor");
  assert.equal(page.document.nodes.find(n => n.id === "add").label, "Add");
  assert.ok(!page.document.nodes.some(n => n.variant === "other-settings-area"));
  assert.equal(oldCron.accepts(null), false); assert.throws(() => oldCron.run(null), /no longer available/);
  const oldDetail = page.handlers.get(page.document.nodes.find(n => n.id === "add").action);
  store.sinks.ssh.remove(owners.ssh); // An old effect cleanup cannot remove the new editor.
  assert.equal(store.compose(options).document.title, "SSH editor");
  store.sinks.ssh.remove(detailOwner); store.sinks.ssh.update(owners.ssh, content("ssh"));
  assert.throws(() => oldDetail.run(null), /no longer available/);
  assert.equal(store.compose(options).document.nodes.filter(n => n.variant === "other-settings-area").length, 3);
  store.dispose(); assert.throws(() => oldCron.run(null), /no longer available/);
});

function harness(mobile, language) {
  const instances = new Map();
  let current, changed = true, document, handlers, request = 0;
  const calls = [], alerts = [];
  const previousWindow = globalThis.window; globalThis.window = { ...previousWindow, setTimeout, clearTimeout };
  const types = createTsModuleLoader().loadModule("src/lib/automation/types.ts");
  const automation = { hooks: { hooks: [{ id: "hook-one", name: "Hook", description: "", enabled: true,
    type: "command", script: "echo hello", event: "tool_execution_end" }] }, cron: { tasks: [{ id: "cron-one", name: "Cron",
    description: "", enabled: true, type: "bash", script: "echo hello", cron: "0 * * * *" }] } };
  const useSyncExternalStore = (subscribe, read) => {
    const [, set] = current.react.useState(0);
    current.react.useEffect(() => subscribe(() => { changed = true; set(n => n + 1); }), [subscribe]);
    return read();
  };
  const react = Object.fromEntries(["useState", "useRef", "useMemo", "useCallback", "useEffect"].map(name => [name, (...args) => current.react[name](...args)]));
  react.useLayoutEffect = (...args) => current.react.useEffect(...args); react.useSyncExternalStore = useSyncExternalStore;
  const { t: translate } = createTsModuleLoader().loadModule("src/i18n/config.ts");
  const locale = { useLocale: () => ({ t: key => language ? translate(key, language) : key }) };
  const loader = createTsModuleLoader({ mocks: {
    react, "../i18n": locale, "../../i18n": locale,
    "./NativeSurface": { NativeSurface: "NativeSurface" }, "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => undefined }, "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => mobile },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../lib/automation": { ...types, useAutomation: () => automation,
      applyHookOps: async ops => { calls.push(["hooks", ops]); },
      applyCronOps: async ops => { calls.push(["cron", ops]); }, validateCronExpression: async () => undefined },
    "@xgent/runtime": { isBrowserRuntime: () => false, invoke: async () => undefined },
    "../../lib/ssh/scan": { scanSshImportCandidates: async () => ({ sshDirPath: "/ssh", keyFiles: [], candidates: [] }) },
    "./SettingsModalShell": { SettingsModalShell: "SettingsModalShell" },
    "./shared": { ConfirmActionPopover: "ConfirmActionPopover", ConfirmDeletePopover: "ConfirmDeletePopover" },
  } });
  const { getDefaultSettings, normalizeSettings } = loader.loadModule("src/lib/settings");
  const { NativeOtherSettings } = loader.loadModule("src/presentation/NativeOtherSettings.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const props = { settings: normalizeSettings({ ...getDefaultSettings(), ssh: { hosts: [{ id: "ssh-one", name: "Server", host: "server.test", port: 22, username: "me" }] } }),
    mobile, nativeSettingsSurfaceId: "settings:other", setSettings: update => { props.settings = update(props.settings); },
    onBack: () => calls.push(["back"]), onClose: () => calls.push(["close"]) };
  const registry = createPresentationActionRegistry();
  function visit(element, path, active) {
    if (!element) return;
    if (Array.isArray(element)) { element.forEach((item, i) => visit(item, `${path}/${i}`, active)); return; }
    if (typeof element.type === "function") {
      let instance = instances.get(path);
      if (instance?.type !== element.type) {
        instance?.hooks.unmount(); instance = { type: element.type, hooks: createReactHookHarness() }; instances.set(path, instance);
      }
      active.add(path); current = instance.hooks;
      visit(instance.hooks.render(() => element.type(element.props)), `${path}/render`, active);
    } else if (element.type === "NativeSurface") {
      if (element.props.document.mode === "alert") alerts.push(element.props);
      else { document = element.props.document; handlers = element.props.handlers; }
    } else visit(element.props?.children, `${path}/children`, active);
  }
  function render() {
    for (let attempts = 0; attempts < 12; attempts++) {
      changed = false; alerts.length = 0;
      const active = new Set(); visit({ type: NativeOtherSettings, props }, "root", active);
      for (const [path, instance] of instances) if (!active.has(path)) { instance.hooks.unmount(); instances.delete(path); }
      if (!changed) break;
      if (attempts === 11) throw new Error("Other settings did not settle");
    }
    validatePresentationDocument({ ...document, version: 1, surface: "settings:other", revision: 1 }, handlers);
    registry.register("settings:other", handlers);
    return document;
  }
  render();
  return { render, calls, alerts, props, node: id => flatten(document.nodes).find(n => n.id === id),
    send: (action, value = null) => registry.dispatch({ surface: "settings:other", action, value, requestId: String(++request) }),
    unmount: () => { for (const instance of instances.values()) instance.hooks.unmount(); instances.clear(); registry.remove("settings:other");
      if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; },
  };
}

test("Other shows the actual Hooks, Cron and SSH lists and switches to real editors in the same session", async () => {
  for (const mobile of [true, false]) {
    const h = harness(mobile);
    try {
      assert.equal(h.render().formFactor, mobile ? "mobile" : "desktop");
      assert.ok(h.node("other:hooks:hook:hook-one")); assert.ok(h.node("other:cron:cron-one")); assert.ok(h.node("other:ssh:ssh-one"));
      await h.send(h.node("other:hooks:hook:hook-one:enabled").action, false);
      assert.equal(h.calls[0][0], "hooks"); assert.equal(h.calls[0][1][0].patch.enabled, false);
      const retiredCron = h.node("other:cron:add").action;
      await h.send(h.node("other:hooks:hook-add").action); h.render();
      assert.ok(h.node("hook-name")); assert.equal(h.node("other:cron:cron-one"), undefined);
      assert.equal((await h.send(retiredCron)).ok, false);
      await h.send(h.render().dismissAction); h.render();
      assert.ok(h.node("other:cron:cron-one"));
      await h.send(h.node("other:cron:add").action); h.render();
      assert.ok(h.node("name")); assert.ok(h.node("cron"));
      await h.send(h.render().dismissAction); h.render();
      await h.send(h.node("other:ssh:ssh-one:edit").action); h.render();
      assert.equal(h.node("host").value, "server.test");
      assert.ok(h.node("back")); assert.equal(h.node("other:hooks:hook:hook-one"), undefined);
      await h.send(h.render().dismissAction); h.render();
      assert.ok(h.node("other:ssh:ssh-one"));
      await h.send(h.node("other:hooks:hook:hook-one:delete").action); h.render();
      assert.equal(h.alerts.length, 1); assert.equal(h.alerts[0].document.mode, "alert");
      assert.ok(h.node("other:cron:cron-one"), "Confirmation alerts must retain the primary settings content");
    } finally { h.unmount(); }
  }
});

test("Other preserves translated mobile navigation and actual save failures without a saved badge", () => {
  for (const language of ["en-US", "zh-CN"]) {
    const h = harness(true, language);
    try {
      assert.equal(h.node("back").label, language === "en-US" ? "Back to Settings" : "返回设置");
      assert.equal(h.render().title, language === "en-US" ? "Other" : "其他");
      h.props.saveState = { status: "error", message: "Storage unavailable" }; h.render();
      assert.equal(h.node("save-status").text, "Storage unavailable");
      h.props.saveState = { status: "saved" }; h.render();
      assert.equal(h.node("save-status"), undefined);
    } finally { h.unmount(); }
  }
});
