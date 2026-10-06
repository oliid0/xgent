import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const walk = value => {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(walk);
  if (typeof value.type === "function" && value.type.name === "CompactAccessSettingsForm") return walk(value.type(value.props));
  return [value, ...walk(value.props?.children), ...walk(value.props?.label), ...walk(value.props?.description), ...walk(value.props?.endContent)];
};

test("Astryx and native access switches preserve consecutive capability changes from the same rendered page", () => {
  const originalWindow = globalThis.window;
  globalThis.window = { setInterval: () => 1, clearInterval() {} };
  try {
    for (const native of [false, true]) {
      const hooks = createReactHookHarness();
      const loader = createTsModuleLoader({ mocks: {
        react: hooks.react,
        "@xgent/runtime": {
          isBrowserRuntime: () => false,
          invoke: async command => command === "cloud_secret_vault_status" ? { githubTokenConfigured: false } : { enabled: false, running: false, urls: [], devices: [], pairedDevices: 0 },
          listen: async () => () => {},
        },
        "../../i18n": { useLocale: () => ({ t: key => key }) },
        "../../lib/browser/browserSessionController": {},
        "../lib/browser/browserSessionController": {},
        "../../lib/system/clipboardText": {},
        "../lib/system/clipboardText": {},
      } });
      const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
      let settings = getDefaultSettings();
      settings.access.blockedLocalCapabilities = ["file_write"];
      settings.access.githubOwner = "preserved-account";
      const props = { settings, setSettings: update => { settings = update(settings); } };
      let change;
      if (native) {
        const { useNativeAccessSettings } = loader.loadModule("src/presentation/nativeAccessSettings.ts");
        const surface = hooks.render(() => useNativeAccessSettings(props, true, false, key => key, () => {}));
        change = (capability, blocked) => surface.handlers.get(`block:${capability}`).run(blocked);
      } else {
        const { AccessSection } = loader.loadModule("src/pages/settings/AccessSection.tsx");
        const nodes = walk(hooks.render(() => AccessSection({ ...props, nativeMobile: false })));
        const keys = { terminal: "Terminal", ssh: "Ssh", git: "Git", file_write: "FileWrite" };
        change = (capability, blocked) => {
          const control = nodes.find(node => node.props?.label === `settings.accessBlock${keys[capability]}` && typeof node.props?.onChange === "function");
          assert.ok(control, `Missing actual ${capability} access switch`);
          control.props.onChange(blocked);
        };
      }
      // No rerender occurs between operations: each must reduce current state.
      change("terminal", true);
      change("ssh", true);
      change("git", true);
      change("ssh", false);
      assert.deepEqual([...settings.access.blockedLocalCapabilities].sort(), ["file_write", "git", "terminal"]);
      assert.equal(settings.access.githubOwner, "preserved-account");
      hooks.unmount();
    }
  } finally {
    globalThis.window = originalWindow;
  }
});

const settle = () => new Promise(resolve => setImmediate(resolve));
const localStatus = (patch = {}) => ({
  enabled: true, running: true, bindAddress: "0.0.0.0", port: 28367,
  urls: ["http://192.168.1.2:28367"], pairedDevices: 0, devices: [], ...patch,
});

function accessHarness(context, native, mobile) {
  const originalWindow = globalThis.window;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timers = new Map();
  let timerId = 0;
  globalThis.setInterval = callback => { timers.set(++timerId, callback); return timerId; };
  globalThis.clearInterval = id => timers.delete(id);
  globalThis.window = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  const hooks = createReactHookHarness();
  const calls = [], panels = [];
  let statusEvent, tree;
  const browserSessionController = {
    ensureSession: args => request("ensureSession", args),
    openPanel: (...args) => panels.push(args),
  };
  function request(command, args) {
    return new Promise((resolve, reject) => calls.push({ command, args, resolve, reject }));
  }
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@xgent/runtime": {
      isBrowserRuntime: () => false,
      invoke: request,
      listen: async (_name, callback) => { statusEvent = callback; return () => {}; },
    },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/browser/browserSessionController": { browserSessionController },
    "../lib/browser/browserSessionController": { browserSessionController },
    "./browser/browserSessionController": {
      normalizeBrowserAddress: value => /^https?:\/\//.test(value) ? value : `http://${value}`,
    },
    "../../lib/system/clipboardText": {},
    "../lib/system/clipboardText": {},
  } });
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  let settings = getDefaultSettings();
  settings.access.webUiEnabled = true;
  settings.access.githubOwner = "account";
  settings.access.lanControlUrl = "http://192.168.1.2:28367/";
  const setSettings = update => { settings = update(settings); };
  const { AccessSection } = loader.loadModule("src/pages/settings/AccessSection.tsx");
  const { useNativeAccessSettings } = loader.loadModule("src/presentation/nativeAccessSettings.ts");
  function render() {
    tree = hooks.render(() => native
      ? useNativeAccessSettings({ settings, setSettings }, true, mobile, key => key, () => {})
      : AccessSection({ settings, setSettings, nativeMobile: mobile }));
    return tree;
  }
  const find = (label, prop) => {
    const node = walk(tree).find(node => node.props?.label === label && typeof node.props?.[prop] === "function");
    assert.ok(node, `Missing actual control ${label}`);
    return node.props[prop];
  };
  const input = (nativeId, label, value) => native
    ? tree.handlers.get(nativeId).run(value)
    : find(label, "onChange")(value);
  const action = (nativeId, label) => native
    ? tree.handlers.get(nativeId).run
    : find(label, "onClick");
  function hasStatus(nativeId, label) {
    if (native) {
      const all = nodes => nodes.flatMap(node => [node, ...all(node.children ?? [])]);
      return all(tree.nodes).find(node => node.id === nativeId)?.label === label;
    }
    return walk(tree).some(node => node.props?.label === label);
  }
  context.after(() => {
    hooks.unmount();
    globalThis.window = originalWindow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });
  render();
  return { hooks, calls, panels, timers, render, input, action, hasStatus,
    emit: status => statusEvent({ payload: status }),
    hasError: message => native
      ? tree.nodes.some(node => node.id === "access-error" && node.label === message)
      : walk(tree).some(node => node.props?.title === message),
    get settings() { return settings; },
  };
}

for (const native of [false, true]) {
  const name = native ? "native" : "Astryx";
  test(`${name} access reserves token operations and ignores a late initial vault response`, async context => {
    const h = accessHarness(context, native, false);
    await settle();
    h.input("github-token", "settings.accessGithubToken", "submitted-token");
    h.render();
    const save = h.action("github-token-save", "settings.accessSaveToken");
    const first = save(), duplicate = save();
    assert.equal(h.calls.filter(call => call.command === "cloud_secret_vault_set_github_token").length, 1);
    h.input("github-token", "settings.accessGithubToken", "new-draft-token");
    h.calls.find(call => call.command === "cloud_secret_vault_set_github_token")
      .resolve({ githubTokenConfigured: true, githubUsername: "account" });
    await Promise.all([first, duplicate]);
    await settle();
    h.render();
    assert.equal(h.hasStatus("github-token-status", "settings.accessTokenConfigured"), true);
    h.calls.find(call => call.command === "cloud_secret_vault_status").resolve({ githubTokenConfigured: false });
    await settle();
    h.render();
    assert.equal(h.hasStatus("github-token-status", "settings.accessTokenConfigured"), true);
    const draft = native ? h.render().nodes.flatMap(function all(node) {
      return [node, ...(node.children ?? []).flatMap(all)];
    }).find(node => node.id === "github-token").value
      : walk(h.render()).find(node => node.props?.label === "settings.accessGithubToken" && node.props.onChange).props.value;
    assert.equal(draft, "new-draft-token", "An accepted earlier save must preserve a newly entered draft");
    const count = h.calls.length;
    h.hooks.unmount();
    await save();
    assert.equal(h.calls.length, count, "A retired callback must not save credentials again");
  });

  test(`${name} access keeps push status and pairing rotation ahead of an older poll`, async context => {
    const h = accessHarness(context, native, false);
    await settle();
    const firstPoll = h.calls.find(call => call.command === "local_access_status");
    assert.ok(firstPoll);
    h.emit(localStatus());
    firstPoll.resolve(localStatus({ running: false, lastError: "old failure" }));
    await settle();
    h.render();
    assert.equal(h.hasStatus("web-ui-status", "settings.accessRunning"), true);
    for (const poll of h.timers.values()) poll();
    const stalePoll = h.calls.filter(call => call.command === "local_access_status").at(-1);
    const rotate = h.action("local-pairing-rotate", "settings.accessNewPairingCode");
    const first = rotate(), duplicate = rotate();
    assert.equal(h.calls.filter(call => call.command === "local_access_rotate_pairing_code").length, 1);
    h.calls.find(call => call.command === "local_access_rotate_pairing_code")
      .resolve(localStatus({ pairingCode: "123456" }));
    await Promise.all([first, duplicate]);
    await settle();
    stalePoll.resolve(localStatus({ running: false, lastError: "old failure" }));
    await settle();
    h.render();
    assert.equal(h.hasStatus("web-ui-status", "settings.accessRunning"), true);
    if (native) {
      const all = nodes => nodes.flatMap(node => [node, ...all(node.children ?? [])]);
      assert.match(all(h.render().nodes).find(node => node.id === "local-pairing-code").text, /123456/);
    } else assert.ok(walk(h.render()).some(node => node.props?.children === "123456"));
  });

  test(`${name} access does not open a computer panel after navigation retires the request`, async context => {
    const h = accessHarness(context, native, true);
    h.calls.find(call => call.command === "cloud_secret_vault_status").resolve({ githubTokenConfigured: false });
    h.calls.find(call => call.command === "lan_pc_status").resolve({ paired: false });
    await settle();
    h.render();
    const open = h.action("lan-open", "settings.accessOpenComputer");
    const first = open(), duplicate = open();
    assert.equal(h.calls.filter(call => call.command === "ensureSession").length, 1);
    h.hooks.unmount();
    h.calls.find(call => call.command === "ensureSession").resolve();
    await Promise.all([first, duplicate]);
    await settle();
    assert.deepEqual(h.panels, []);
    const count = h.calls.length;
    await open();
    assert.equal(h.calls.length, count);
  });

  test(`${name} access keeps an accepted pairing ahead of a late initial connectivity failure`, async context => {
    const h = accessHarness(context, native, true);
    h.input("lan-pairing-code", "settings.accessLanPairingCode", "123456");
    h.render();
    const pair = h.action("lan-pair", "settings.accessPairComputer");
    const first = pair(), duplicate = pair();
    assert.equal(h.calls.filter(call => call.command === "lan_pc_pair").length, 1);
    h.calls.find(call => call.command === "lan_pc_pair")
      .resolve({ paired: true, baseUrl: "http://192.168.1.3:28367", deviceName: "Phone" });
    await Promise.all([first, duplicate]);
    await settle();
    h.render();
    assert.equal(h.settings.access.lanControlUrl, "http://192.168.1.3:28367/");
    h.calls.find(call => call.command === "lan_pc_status").reject(new Error("old connectivity failure"));
    await settle();
    h.render();
    assert.equal(h.hasError("old connectivity failure"), false);
    assert.equal(h.settings.access.lanControlUrl, "http://192.168.1.3:28367/");
  });
}
