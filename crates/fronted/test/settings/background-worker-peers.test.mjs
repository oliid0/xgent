import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const settle = () => new Promise(resolve => setImmediate(resolve));
const peer = (id = "original-pc") => ({ peerId: id, baseUrl: "http://192.168.1.2:28367", online: true,
  host: { hostId: id, platform: "macos", executorReady: true, acceptsBackgroundTasks: true, workspaceAvailable: true },
  endpoints: [{ baseUrl: "http://192.168.1.2:28367", network: "lan", online: true },
    { baseUrl: "http://100.70.1.2:28367", network: "tailnet", online: true }] });

function fixture(context, { enabled = true, reply, onRemoved } = {}) {
  const hooks = createReactHookHarness(), calls = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args });
      return reply ? reply(command, args) : { peers: [peer()] };
    } },
    "@xgent/runtime": { isTauriRuntime: () => true },
  } });
  const { useWorkerPeers } = loader.loadModule("src/lib/automation/useWorkerPeers.ts");
  let view;
  const render = () => view = hooks.render(() => useWorkerPeers(enabled, onRemoved));
  context.after(() => hooks.unmount());
  render();
  return { calls, render, hooks, get view() { return view; }, set enabled(value) { enabled = value; } };
}

test("worker catalog stays on the native installation and includes both authenticated endpoints", async context => {
  const f = fixture(context, { enabled: false });
  assert.equal(f.calls.length, 0);
  f.enabled = true; f.render();
  assert.equal(f.view.busy, "refresh");
  await settle(); f.render();
  assert.equal(f.view.error, "");
  assert.deepEqual(f.calls, [{ command: "worker_peer_list", args: undefined }]);
  assert.deepEqual(f.view.peers[0].endpoints.map(e => e.network), ["lan", "tailnet"]);
});

test("pairing refreshes during a running probe coalesce into one follow-up discovery", async context => {
  let release;
  let probes = 0;
  const f = fixture(context, { reply: async () => {
    if (++probes === 1) return new Promise(resolve => { release = resolve; });
    return { peers: [peer("newly-paired")] };
  } });
  await f.view.refresh(); await f.view.refresh(); await f.view.refresh();
  assert.equal(probes, 1);
  release({ peers: [] }); await settle(); f.render();
  assert.equal(probes, 2);
  assert.equal(f.view.peers[0].peerId, "newly-paired");
  assert.equal(f.view.busy, "");
});

test("confirmed endpoint removal keeps its peer and other address when subsequent discovery fails", async context => {
  let probes = 0, removed = 0;
  const f = fixture(context, { onRemoved: async () => { removed++; }, reply: async command => {
    if (command === "worker_peer_forget") return;
    if (++probes > 1) throw new Error("Tailnet temporarily unreachable");
    return { peers: [peer()] };
  } });
  await settle(); f.render();
  await assert.rejects(f.view.forgetEndpoint("original-pc", "http://192.168.1.2:28367"), /temporarily unreachable/); f.render();
  assert.deepEqual(f.calls[1], { command: "worker_peer_forget", args: { peer_id: "original-pc", base_url: "http://192.168.1.2:28367" } });
  assert.equal(removed, 1);
  assert.equal(f.view.peers.length, 1);
  assert.equal(f.view.peers[0].endpoints[0].network, "tailnet");
  assert.equal(f.view.peers[0].online, false);
  assert.match(f.view.error, /temporarily unreachable/);
});

test("failed credential removal preserves the device and never announces success", async context => {
  let removed = 0;
  const f = fixture(context, { onRemoved: async () => { removed++; }, reply: async command => {
    if (command === "worker_peer_forget") throw new Error("Protected vault unavailable");
    return { peers: [peer()] };
  } });
  await settle(); f.render();
  await assert.rejects(f.view.forget("original-pc"), /vault unavailable/); f.render();
  assert.equal(f.view.peers.length, 1);
  assert.equal(removed, 0);
  assert.match(f.view.error, /vault unavailable/);
  assert.equal(f.calls.filter(c => c.command === "worker_peer_list").length, 1);
});

test("a late old discovery cannot repopulate a closed or reopened settings page", async context => {
  let release; let probes = 0;
  const f = fixture(context, { reply: async () => {
    if (++probes === 1) return new Promise(resolve => { release = resolve; });
    return { peers: [peer("current")] };
  } });
  f.enabled = false; f.render();
  f.enabled = true; f.render();
  await settle(); f.render();
  release({ peers: [peer("stale")] }); await settle(); f.render();
  assert.equal(f.view.peers[0].peerId, "current");
  assert.equal(f.view.busy, "");
});

test("device removal is serialized while the exact protected peer is being removed", async context => {
  let release; let removed;
  const f = fixture(context, { reply: async (command, args) => {
    if (command === "worker_peer_forget") { removed = args.peer_id; return new Promise(resolve => { release = resolve; }); }
    return { peers: removed ? [] : [peer()] };
  } });
  await settle(); f.render();
  const first = f.view.forget("original-pc");
  const second = f.view.forget("different-pc"); await second;
  assert.equal(f.calls.filter(c => c.command === "worker_peer_forget").length, 1);
  release(); await first; f.render();
  assert.equal(f.view.peers.length, 0);
});

test("Astryx endpoint controls identify the address, dispatch real removal, and lock during discovery", async context => {
  const hooks = createReactHookHarness(); let endpointRemoved = false, release;
  const calls = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "@xgent/runtime": { isTauriRuntime: () => true },
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "worker_peer_forget") { endpointRemoved = true; return; }
      if (endpointRemoved) return new Promise(resolve => { release = resolve; });
      return { peers: [peer()] };
    } },
  } });
  const { useWorkerPeers } = loader.loadModule("src/lib/automation/useWorkerPeers.ts");
  const { WorkerPeersSection } = loader.loadModule("src/pages/settings/WorkerPeersSection.tsx");
  const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk)
    : [value, ...walk(value.props?.children), ...walk(value.props?.label), ...walk(value.props?.description), ...walk(value.props?.endContent)];
  const render = () => hooks.render(() => WorkerPeersSection({ workers: useWorkerPeers(true), disabled: false }));
  context.after(() => hooks.unmount());
  render(); await settle();
  let controls = walk(render());
  const address = "http://192.168.1.2:28367";
  const remove = controls.find(node => node.props?.label === `settings.workerEndpointForget ${address}`);
  assert.ok(remove); assert.equal(remove.props.isDisabled, false);
  remove.props.onClick(); await settle();
  controls = walk(render());
  assert.equal(controls.find(node => node.props?.label === "settings.workerPeersRefresh").props.isDisabled, true);
  assert.deepEqual(calls[1], { command: "worker_peer_forget", args: { peer_id: "original-pc", base_url: address } });
  const remaining = peer(); remaining.endpoints.shift(); remaining.baseUrl = remaining.endpoints[0].baseUrl;
  release({ peers: [remaining] }); await settle();
  assert.ok(!walk(render()).some(node => node.props?.label === `settings.workerEndpointForget ${address}`));
});

test("SwiftUI worker devices expose actual endpoints, explicit removal errors and desktop pairing", async context => {
  const hooks = createReactHookHarness(), calls = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "worker_peer_forget") throw new Error("Protected removal rejected");
      return { peers: [peer()] };
    } },
    "@xgent/runtime": { isTauriRuntime: () => true, listen: async () => () => {}, invoke: async command => {
      if (command === "cloud_secret_vault_status") return { githubTokenConfigured: false };
      if (command === "local_access_status") return { enabled: false, running: false, urls: [], devices: [], pairedDevices: 0 };
      throw new Error(`Unexpected ${command}`);
    } },
    "../lib/browser/browserSessionController": { browserSessionController: {} },
  } });
  const { useNativeAccessSettings } = loader.loadModule("src/presentation/nativeAccessSettings.ts");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  let settings = getDefaultSettings();
  const render = () => hooks.render(() => useNativeAccessSettings({ settings, setSettings: next => { settings = next(settings); } }, true, false, key => key, () => {}));
  const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);
  context.after(() => hooks.unmount());
  render(); await settle(); let ui = render();
  assert.ok(walk(ui.nodes).find(node => node.id === "worker-pair-url"));
  assert.ok(walk(ui.nodes).some(node => node.text?.includes("Tailnet") || node.text?.includes("settings.workerNetworktailnet")));
  const action = ui.handlers.get("worker-peer:original-pc:endpoint:1:forget");
  assert.equal(action.enabled, true);
  await assert.rejects(action.run(null), /Protected removal rejected/);
  ui = render();
  assert.ok(walk(ui.nodes).find(node => node.id === "worker-peers-error" && node.label === "Protected removal rejected"));
  assert.deepEqual(calls.at(-1), { command: "worker_peer_forget", args: { peer_id: "original-pc", base_url: "http://100.70.1.2:28367" } });
});
