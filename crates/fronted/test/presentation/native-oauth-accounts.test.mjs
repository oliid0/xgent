import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const account = (id, isDefault = false) => ({ id, email: `${id}@example.com`, planType: "Plus", isDefault });
const deviceFlow = (extra = {}) => ({ flowId: "flow-1", userCode: "ABCD-1234", verificationUri: "https://auth.openai.com/codex/device", expiresAt: Math.floor(Date.now() / 1000) + 900, intervalSeconds: 3, ...extra });
function harness(options = {}) {
  const hooks = createReactHookHarness(), calls = [], changes = [], opened = [], copied = [];
  let accounts = [account("one", true), account("two")], data;
  let props = { value: "", browserRuntime: false, enabled: true, scopeKey: "provider-one", ...options.props };
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (options.commands?.[command]) return options.commands[command](args);
    switch (command) {
      case "provider_oauth_status_codex": return { accounts, defaultAccountId: accounts[0]?.id };
      case "provider_oauth_start_codex": return deviceFlow();
      case "provider_oauth_poll_codex": return { state: "pending" };
      case "provider_oauth_cancel_codex": return;
      case "provider_oauth_remove_codex_account": accounts = accounts.filter(item => item.id !== args.accountId); return { accounts, defaultAccountId: accounts[0]?.id };
      default: throw new Error(`Unexpected OAuth command ${command}`);
    }
  };
  const mocks = {
    react: hooks.react,
    "@xgent/runtime": { invoke, openUrl: async url => { opened.push(url); if (options.open) await options.open(url); } },
    "../../lib/system/clipboardText": { writeClipboardText: async text => { copied.push(text); return options.copy ? options.copy(text) : true; } },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../components/icons": { CheckCircle2: "CheckCircle2", Trash2: "Trash2" },
  };
  for (const name of ["Banner", "Button", "Card", "Center", "EmptyState", "Icon", "IconButton", "Spinner", "StatusDot", "Text"]) mocks[`@astryxdesign/core/${name}`] = { [name]: name };
  mocks["@astryxdesign/core/Layout"] = { HStack: "HStack", VStack: "VStack" };
  mocks["@astryxdesign/core/List"] = { List: "List", ListItem: "ListItem" };
  const loader = createTsModuleLoader({ mocks });
  const { useCodexOAuthAccounts } = loader.loadModule("src/pages/settings/useCodexOAuthAccounts.ts");
  const { nativeOAuthAccounts } = loader.loadModule("src/presentation/nativeOAuthAccounts.ts");
  const { presentationControls } = loader.loadModule("src/presentation/controls.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const onChange = value => { changes.push([props.scopeKey, value]); props = { ...props, value }; };
  const render = () => hooks.render(() => {
    data = useCodexOAuthAccounts({ ...props, onChange }, key => key);
    const c = presentationControls();
    const document = { version: 1, surface: "oauth-settings", revision: 1, mode: "sheet", appearance: "light", title: "Accounts", nodes: [nativeOAuthAccounts(c, data, props.value, key => key)] };
    validatePresentationDocument(document, c.handlers);
    return { document, handlers: c.handlers };
  });
  const dispatch = async (id, value = null) => {
    const handler = render().handlers.get(id); assert.ok(handler, id); assert.equal(handler.enabled, true, id); assert.equal(handler.accepts(value), true);
    await handler.run(value); await tick(); return render();
  };
  return { render, dispatch, calls, changes, opened, copied, setProps: next => { props = { ...props, ...next }; },
    setAccounts: next => { accounts = next; }, unmount: () => hooks.unmount(), replay: () => hooks.replayEffects(),
    get data() { return data; }, get value() { return props.value; }, loader,
  };
}
const count = (h, command) => h.calls.filter(([name]) => name === `provider_oauth_${command}_codex`).length;

test("native managed OAuth loads actual account metadata and routes selection/removal through the shared backend", async () => {
  const h = harness(); h.render(); await tick(); h.render();
  assert.equal(h.value, "one"); assert.equal(h.data.loaded, true);
  assert.ok(JSON.stringify(h.render().document).includes("one@example.com"));
  await h.dispatch("oauth-select:two"); assert.equal(h.value, "two");
  await h.dispatch("oauth-remove:two"); assert.equal(h.value, "one");
  assert.equal(h.data.status.accounts.length, 1);
  assert.equal(h.calls.find(([name]) => name === "provider_oauth_remove_codex_account")[1].accountId, "two"); h.unmount();
});

test("browser-only and inactive OAuth never query local accounts or initiate login", async () => {
  for (const props of [{ browserRuntime: true }, { enabled: false }]) {
    const h = harness({ props }); h.render(); await tick(); h.render();
    await h.data.startLogin(); await h.data.reload(); h.data.selectAccount("one");
    assert.equal(h.calls.length, 0); assert.equal(h.changes.length, 0); h.unmount();
  }
});

test("failed OAuth status exposes retry and inline callback identity changes never trigger extra reads", async () => {
  let fail = true;
  const h = harness({ commands: { provider_oauth_status_codex: async () => {
    if (fail) throw new Error("vault unavailable"); return { accounts: [account("one")], defaultAccountId: "one" };
  } } });
  h.render(); await tick(); let s = h.render();
  assert.ok(JSON.stringify(s.document).includes("vault unavailable")); assert.equal(s.handlers.get("oauth-retry").enabled, true);
  fail = false; await h.dispatch("oauth-retry");
  assert.equal(h.data.loaded, true); const loads = count(h, "status");
  h.render(); h.render(); await tick(); assert.equal(count(h, "status"), loads); h.unmount();
});

test("duplicate login starts are serialized and a failed browser launch preserves code with real reopen/copy/cancel", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const pause = deferred(); let fail = true;
  const h = harness({ commands: { provider_oauth_start_codex: () => pause.promise }, open: async () => { if (fail) throw new Error("browser unavailable"); } });
  h.render(); await tick(); h.render(); const stale = h.data;
  const start = stale.startLogin(); await stale.startLogin(); assert.equal(count(h, "start"), 1);
  pause.resolve(deviceFlow()); await start; h.render();
  assert.equal(h.data.deviceCode.userCode, "ABCD-1234"); assert.equal(h.data.error, "browser unavailable");
  assert.equal(h.render().handlers.get("oauth-add").enabled, false);
  fail = false; await h.dispatch("oauth-open"); await h.dispatch("oauth-copy");
  assert.equal(h.opened.length, 2); assert.deepEqual(h.copied, ["ABCD-1234"]);
  await h.dispatch("oauth-cancel"); assert.equal(h.data.deviceCode, null); assert.equal(count(h, "cancel"), 1);
  context.mock.timers.tick(60000); await tick(); assert.equal(count(h, "poll"), 0); h.unmount();
});

test("a start completing after provider navigation is canceled and cannot open the browser or select another provider", async () => {
  const pause = deferred(), h = harness({ commands: { provider_oauth_start_codex: () => pause.promise } });
  h.render(); await tick(); h.render(); const old = h.data, start = old.startLogin();
  h.setProps({ scopeKey: "provider-two", value: "two" }); h.render(); await tick(); h.render();
  pause.resolve(deviceFlow()); await start; h.render();
  assert.equal(h.opened.length, 0); assert.equal(h.data.deviceCode, null); assert.equal(count(h, "cancel"), 1);
  old.selectAccount("one"); await old.removeAccount("one"); await old.startLogin();
  assert.equal(h.value, "two"); assert.equal(count(h, "start"), 1); assert.equal(h.data.status.accounts.length, 2); h.unmount();
});

test("device polling waits for the supplied interval, completes once and refreshes the stored account list", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1800000000000 });
  const h = harness({ commands: { provider_oauth_poll_codex: async () => {
    h.setAccounts([account("one"), account("new")]); return { state: "complete", account: account("new") };
  } } });
  h.render(); await tick(); await h.dispatch("oauth-add");
  context.mock.timers.tick(2999); await tick(); assert.equal(count(h, "poll"), 0);
  context.mock.timers.tick(1); await tick(); h.render();
  assert.equal(h.value, "new"); assert.equal(h.data.deviceCode, null);
  assert.equal(h.data.status.accounts.some(item => item.id === "new"), true);
  context.mock.timers.tick(60000); await tick(); assert.equal(count(h, "poll"), 1); h.unmount();
});

test("cancel during an in-flight poll rejects its late completion and account selection", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const pause = deferred(), h = harness({ commands: { provider_oauth_poll_codex: () => pause.promise } });
  h.render(); await tick(); await h.dispatch("oauth-add");
  context.mock.timers.tick(3000); await tick(); assert.equal(count(h, "poll"), 1);
  await h.dispatch("oauth-cancel"); pause.resolve({ state: "complete", account: account("retired") }); await tick(); h.render();
  assert.equal(h.value, "one"); assert.equal(h.data.deviceCode, null); assert.equal(count(h, "cancel"), 1); h.unmount();
});

test("expired authorization stops polling, reports expiry and retires its actual backend flow", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1800000000000 });
  const h = harness({ commands: { provider_oauth_start_codex: async () => deviceFlow({ expiresAt: Math.floor(Date.now() / 1000) + 2 }) } });
  h.render(); await tick(); await h.dispatch("oauth-add");
  context.mock.timers.tick(2000); await tick(); h.render();
  assert.equal(h.data.error, "settings.providerOAuthExpired"); assert.equal(h.data.deviceCode, null);
  assert.equal(count(h, "poll"), 0); assert.equal(count(h, "cancel"), 1); h.unmount();
});

test("invalid device URL never opens an unsafe scheme and unavailable clipboard reports actual failure", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const invalid = harness({ commands: { provider_oauth_start_codex: async () => deviceFlow({ verificationUri: "file:///private" }) } });
  invalid.render(); await tick(); await invalid.dispatch("oauth-add");
  assert.equal(invalid.opened.length, 0); assert.equal(count(invalid, "cancel"), 1); assert.equal(invalid.data.deviceCode, null); invalid.unmount();
  const h = harness({ copy: async () => false }); h.render(); await tick(); await h.dispatch("oauth-add");
  await h.dispatch("oauth-copy"); assert.equal(h.data.error, "settings.providerOAuthCopyFailed");
  assert.equal(h.data.deviceCode.userCode, "ABCD-1234"); h.unmount();
});

test("unmount cancels live login and retires a delayed start without reporting fake successful authentication", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const active = harness(); active.render(); await tick(); await active.dispatch("oauth-add"); active.unmount(); await tick();
  assert.equal(count(active, "cancel"), 1); context.mock.timers.tick(3000); await tick(); assert.equal(count(active, "poll"), 0);
  const pause = deferred(), late = harness({ commands: { provider_oauth_start_codex: () => pause.promise } });
  late.render(); await tick(); late.render(); const pending = late.data.startLogin(); late.unmount();
  pause.resolve(deviceFlow()); await pending; assert.equal(count(late, "cancel"), 1); assert.equal(late.opened.length, 0);
});

test("Astryx OAuth presentation uses the shared controller and exposes usable browser recovery/copy/cancel actions", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness(); h.render(); await tick(); await h.dispatch("oauth-add");
  const componentHooks = createReactHookHarness();
  const mocks = { react: componentHooks.react, "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../components/icons": { CheckCircle2: "CheckCircle2", Trash2: "Trash2" }, "./useCodexOAuthAccounts": { useCodexOAuthAccounts: () => h.data } };
  for (const name of ["Banner", "Button", "Card", "Center", "EmptyState", "Icon", "IconButton", "Spinner", "StatusDot", "Text"]) mocks[`@astryxdesign/core/${name}`] = { [name]: name };
  mocks["@astryxdesign/core/Layout"] = { HStack: "HStack", VStack: "VStack" }; mocks["@astryxdesign/core/List"] = { List: "List", ListItem: "ListItem" };
  const { CodexOAuthAccounts } = createTsModuleLoader({ mocks }).loadModule("src/pages/settings/CodexOAuthAccounts.tsx");
  const root = componentHooks.render(() => CodexOAuthAccounts({ value: "one", onChange() {}, browserRuntime: false }));
  const walk = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
  const nodes = walk(root), buttons = nodes.filter(node => node.type === "Button");
  await buttons.find(node => node.props.label === "settings.providerOAuthOpenBrowser").props.onClick();
  await tick(); h.render();
  await buttons.find(node => node.props.label === "ABCD-1234").props.onClick();
  await tick(); h.render();
  await buttons.find(node => node.props.label === "settings.cancel").props.onClick(); await tick(); h.render();
  assert.equal(h.opened.length, 2); assert.deepEqual(h.copied, ["ABCD-1234"]); assert.equal(h.data.deviceCode, null);
  h.unmount(); componentHooks.unmount();
});
