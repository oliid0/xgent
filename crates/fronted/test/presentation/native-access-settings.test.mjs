import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(context, mobile, backend) {
  const states = [];
  const effects = new Map();
  const pending = [];
  const calls = [];
  const copies = [];
  const panels = [];
  let cursor = 0;
  let enabled = false;
  let statusEvent;
  let unlistened = 0;
  let opened = 0;
  let controls;
  let request = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useRef(current) {
        const index = cursor++;
        if (!(index in states)) states[index] = { current };
        return states[index];
      },
      useCallback(callback, dependencies) {
        const index = cursor++;
        const previous = states[index];
        if (!previous || !previous.dependencies.every((value, i) => Object.is(value, dependencies[i])))
          states[index] = { dependencies, callback };
        return states[index].callback;
      },
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (next) => {
          states[index] = typeof next === "function" ? next(states[index]) : next;
        }];
      },
      useEffect(effect, dependencies) {
        const index = cursor++;
        const previous = effects.get(index);
        if (previous?.dependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
        const current = { dependencies };
        effects.set(index, current);
        pending.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
      },
    },
    "@xgent/runtime": {
      invoke: async (command, args) => { calls.push({ command, args }); return backend(command, args); },
      listen: async (_event, callback) => { statusEvent = callback; return () => unlistened++; },
    },
    "@tauri-apps/api/core": {
      invoke: async (command,args) => command.startsWith("tailscale_") ? backend(command,args) : ({ revision: 0, supported: true, registered: false, reason: null, backgroundLaunch: false, workerReady: true, observedAtMs: 1700000000000 }),
    },
    "@tauri-apps/api/event": { listen: async () => () => {} },
    "../lib/browser/browserSessionController": {
      browserSessionController: {
        ensureSession: async (options) => panels.push(options),
        openPanel: (...args) => panels.push(args),
      },
    },
    "./browser/browserSessionController": {
      normalizeBrowserAddress: (value) => /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`,
    },
    "../lib/system/clipboardText": {
      writeClipboardText: async (text) => { copies.push(text); return true; },
    },
  } });
  const { useNativeAccessSettings } = loader.loadModule("src/presentation/nativeAccessSettings.ts");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let settings = getDefaultSettings();
  settings.access.webUiEnabled = false;
  const render = () => {
    cursor = 0;
    controls = useNativeAccessSettings({ settings, setSettings: (update) => settings = update(settings) },
      enabled, mobile, (key) => key, () => opened++);
    registry.register("access", controls.handlers);
    for (const effect of pending.splice(0)) effect();
    return controls;
  };
  const allNodes = (nodes) => nodes.flatMap((node) => [node, ...allNodes(node.children ?? [])]);
  const node = (id) => allNodes(controls.nodes).find((node) => node.id === id);
  const dispatch = async (action, value = null) => {
    const result = await registry.dispatch({ surface: "access", action, value, requestId: String(++request) });
    render();
    return result;
  };
  context.after(() => { for (const effect of effects.values()) effect.cleanup?.(); });
  return { render, node, dispatch, calls, copies, panels,
    get settings() { return settings; }, get opened() { return opened; },
    get unlistened() { return unlistened; },
    set enabled(value) { enabled = value; },
    emit: (payload) => statusEvent({ payload }),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("native cloud settings preserve working namespace controls without explanatory paragraphs", async (context) => {
  const h = harness(context, true, async (command) => {
    if (command === "cloud_secret_vault_status") return { githubTokenConfigured: false };
    throw new Error(`Unexpected native call: ${command}`);
  });
  h.enabled = true;
  h.render();
  await settle();
  h.render();
  assert.equal(h.node("cloud-repository-hint"), undefined);
  assert.equal((await h.dispatch("github-owner", "my-owner")).ok, true);
  assert.equal((await h.dispatch("github-repository", "my-private-tasks")).ok, true);
  assert.equal(h.settings.access.githubOwner, "my-owner");
  assert.equal(h.settings.access.githubRepository, "my-private-tasks");
  assert.equal(h.node("github-repository").value, "my-private-tasks");
  assert.equal(h.calls.some(({ command }) => command === "cloud_task_start"), false);
});
const localStatus = (patch = {}) => ({
  enabled: true, running: true, bindAddress: "0.0.0.0", port: 28367,
  urls: ["http://192.168.1.2:28367", "http://127.0.0.1:28367"],
  pairedDevices: 1, devices: [{ deviceId: "phone", label: "iPhone", lastSeenAt: 1720000000000 }],
  ...patch,
});

test("native Tailscale observation refresh shows client state and own addresses while preserving LAN pairing URLs", async context => {
  let state = "login-required";
  const h = harness(context, false, async command => {
    if (command === "tailscale_install_status") return { id:"",phase:"idle",version:null,package:null,sha256:null,error:null,updatedAt:0 };
    if (command === "tailscale_setup_status") return { state, addresses: state === "running" ? ["100.70.1.2"] : [], observedAt: 1720000000000 };
    if (command === "cloud_secret_vault_status") return { githubTokenConfigured: false };
    if (command === "worker_peer_list") return { peers: [] };
    if (command === "local_access_status") return localStatus({ tailscale: {
      state, addresses: state === "running" ? ["100.70.1.2"] : [], observedAt: 1720000000000,
    } });
    throw new Error(`Unexpected command ${command}`);
  });
  h.enabled = true; h.render(); await settle(); h.render();
  assert.match(h.node("tailscale-observed").text, /settings.tailscaleLoginRequired/);
  assert.equal(h.node("tailscale-hint"), undefined);
  state = "running";
  assert.equal((await h.dispatch("tailscale-refresh")).ok, true);
  assert.match(h.node("tailscale-observed").text, /settings.tailscaleRunning · 100.70.1.2/);
  assert.equal(h.node("web-ui-url:0").text, "http://192.168.1.2:28367");
  state = "offline"; await h.dispatch("tailscale-refresh");
  assert.match(h.node("tailscale-observed").text, /settings.tailscaleOffline/);
  assert.doesNotMatch(h.node("tailscale-observed").text, /100.70.1.2/);
});

test("native macOS access shows live Rust addresses, pairing and revocation without stale polling overwrites", async (context) => {
  let pendingStatus;
  let delayStatus = false;
  const h = harness(context, false, async (command, args) => {
    if (command === "cloud_secret_vault_status") return { githubTokenConfigured: false };
    if (command === "local_access_status") {
      if (delayStatus) return new Promise((resolve) => { pendingStatus = resolve; });
      return localStatus();
    }
    if (command === "local_access_rotate_pairing_code") return localStatus({ pairingCode: "123456" });
    if (command === "local_access_revoke_device") {
      assert.deepEqual(args, { deviceId: "phone" });
      return localStatus({ pairedDevices: 0, devices: [], pairingCode: "123456" });
    }
    throw new Error(`Unexpected command ${command}`);
  });
  assert.deepEqual(h.render().nodes, []);
  assert.equal(h.calls.length, 0);
  h.enabled = true;
  h.render();
  await settle();
  h.render();
  assert.equal(h.node("web-ui-status").label, "settings.accessRunning");
  assert.equal(h.node("web-ui-url:0").text, "http://192.168.1.2:28367");
  assert.equal(h.node("web-ui-url:1").text, "http://127.0.0.1:28367");
  assert.equal((await h.dispatch("web-ui-copy:0")).ok, true);
  assert.equal(h.copies[0], "http://192.168.1.2:28367");
  assert.equal((await h.dispatch("web-ui-port", 65536)).acceptedValue, 65535);
  assert.equal((await h.dispatch("web-ui-port", 123.9)).acceptedValue, 124);
  assert.equal(h.settings.access.webUiPort, 124);
  assert.equal((await h.dispatch("web-ui-scope", "public")).ok, false);
  await h.dispatch("web-ui-enabled", true);
  await settle();
  h.render();
  await h.dispatch("local-pairing-rotate");
  assert.match(h.node("local-pairing-code").text, /123456/);
  await h.dispatch("local-pairing-copy");
  assert.equal(h.copies.at(-1), "123456");

  delayStatus = true;
  const refresh = h.dispatch("web-ui-refresh");
  await settle();
  h.emit(localStatus({ running: false, lastError: "Bind failed" }));
  pendingStatus(localStatus());
  await refresh;
  assert.equal(h.node("web-ui-status").label, "settings.accessFailed");
  assert.equal(h.node("web-ui-error").label, "Bind failed");
  await h.dispatch("local-device:phone:revoke");
  assert.equal(h.node("local-device:phone"), undefined);
  assert.ok(h.node("local-devices-empty"));
  await h.dispatch("block:terminal", true);
  await h.dispatch("block:git", true);
  assert.ok(h.settings.access.blockedLocalCapabilities.includes("terminal"));
  assert.ok(h.settings.access.blockedLocalCapabilities.includes("git"));
  h.enabled = false;
  h.render();
  assert.ok(h.unlistened > 0);
});

test("native iOS pairing repairs the stored endpoint, checks connectivity and opens the actual computer browser", async (context) => {
  let connectivityFails = false;
  let vaultFails = true;
  let resolveOldToken;
  const h = harness(context, true, async (command, args) => {
    if (command === "cloud_secret_vault_status") {
      if (vaultFails) throw new Error("Vault offline");
      return { githubTokenConfigured: false };
    }
    if (command === "lan_pc_status") {
      if (connectivityFails) throw new Error("Computer offline");
      return { paired: true, baseUrl: "http://192.168.1.2" };
    }
    if (command === "lan_pc_pair") {
      assert.equal(args.baseUrl, "http://192.168.1.3:28367/");
      assert.equal(args.code, "123456");
      assert.equal(args.deviceName, "My iPhone");
      return { paired: true, baseUrl: args.baseUrl };
    }
    if (command === "lan_pc_disconnect") return { paired: false };
    if (command === "cloud_secret_vault_set_github_token") return new Promise((resolve) => { resolveOldToken = resolve; });
    throw new Error(`Unexpected command ${command}`);
  });
  h.enabled = true;
  h.render();
  await settle();
  h.render();
  assert.equal(h.settings.access.lanControlUrl, "http://192.168.1.2:28367/");
  assert.equal(h.node("lan-prefer").disabled, false, "vault failure cannot disable an independently paired computer");
  assert.equal(h.node("access-error").label, "Vault offline");
  connectivityFails = true;
  assert.equal((await h.dispatch("lan-refresh")).ok, false);
  assert.equal(h.node("access-error").label, "Computer offline");
  connectivityFails = false;
  await h.dispatch("lan-refresh");
  await h.dispatch("lan-url", "192.168.1.3/path?q=1");
  assert.equal((await h.dispatch("lan-pairing-code", "12a345678")).acceptedValue, "123456");
  await h.dispatch("lan-device-name", " My iPhone ");
  assert.equal((await h.dispatch("lan-pair")).ok, true);
  assert.equal(h.node("lan-pairing-code").value, "");
  await h.dispatch("lan-prefer", true);
  await h.dispatch("lan-open");
  assert.equal(h.opened, 1);
  assert.deepEqual(h.panels, [{ sessionId: "lan-control", url: "http://192.168.1.3:28367/", visible: false }, ["lan-control", "user"]]);
  await h.dispatch("lan-disconnect");
  assert.equal(h.settings.access.preferLanPcExecution, false);
  assert.equal(h.node("lan-prefer").disabled, true);

  await h.dispatch("github-owner", "owner");
  await h.dispatch("github-token", "private-token");
  const tokenSave = h.dispatch("github-token-save");
  await settle();
  h.enabled = false;
  h.render();
  vaultFails = false;
  h.enabled = true;
  h.render();
  await settle();
  h.render();
  resolveOldToken({ githubTokenConfigured: true, githubUsername: "retired-owner" });
  await tokenSave;
  assert.equal(h.node("github-token-status").label, "settings.accessTokenMissing");
  assert.equal(h.node("github-token").value, "", "secret drafts are cleared when the route closes");
  assert.equal(h.node("access-busy"), undefined);
  assert.equal(h.calls.some(({ command }) => command === "local_access_status"), false, "iOS never starts a desktop HTTP host");
});
