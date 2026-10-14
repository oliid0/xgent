import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const service = (n, platform = "windows") => ({ hostId: id(n), platform, urls: [`http://192.168.1.${n}:28367`] });
const services = [service(1, "macos"), service(2, "macos"), service(3), service(4), service(5)];
const settle = () => new Promise(resolve => setImmediate(resolve));
const loader = createTsModuleLoader();
const { validateWorkerDiscovery } = loader.loadModule("src/lib/automation/workerDiscovery.ts");

test("five decoded discovery records remain untrusted addresses, distinct from a paired execution roster", () => {
  const result = validateWorkerDiscovery({ services: services.map(item => ({ ...item, sessionToken: "discard", executorReady: true })) });
  assert.equal(result.length, 5); assert.equal(result.filter(item => item.platform === "macos").length, 2);
  assert.deepEqual(Object.keys(result[0]).sort(), ["hostId", "platform", "urls"]);
  assert.deepEqual(result, services);
  assert.equal(validateWorkerDiscovery({ services: [service(1), service(1)] }).length, 1);
});

test("discovery refuses credential/public/loopback/service/DNS/path/query endpoints and malformed or unbounded metadata", () => {
  for (const url of ["https://192.168.1.2:28367", "http://user:secret@192.168.1.2:28367", "http://8.8.8.8:28367", "http://127.0.0.1:28367", "http://100.100.100.100:28367", "http://100.115.92.1:28367", "http://100.128.1.2:28367", "http://worker.example:28367", "http://192.168.1.2:28367/private", "http://192.168.1.2:28367?token=secret", "http://192.168.1.2:28367#other"]) assert.throws(() => validateWorkerDiscovery({ services: [{ ...service(1), urls: [url] }] }));
  for (const value of [null, {}, { services: 1 }, { services: Array(65).fill(service(1)) }, { services: [{ ...service(1), hostId: "unknown" }] }, { services: [{ ...service(1), platform: "fake" }] }, { services: [{ ...service(1), urls: [] }] }, { services: [{ ...service(1), urls: Array(17).fill(service(1).urls[0]) }] }]) assert.throws(() => validateWorkerDiscovery(value));
});

test("LAN and observed Tailnet candidates merge by installation, prefer LAN and never acquire credentials or capabilities", () => {
  const lan = service(1), overlay = { ...lan, urls: ["http://100.70.1.2:28367"], sessionToken: "discard", executorReady: true };
  assert.deepEqual(validateWorkerDiscovery({ services: [overlay, lan, overlay] }), [{ ...lan, urls: [...lan.urls, ...overlay.urls] }]);
  assert.throws(() => validateWorkerDiscovery({ services: [lan, { ...overlay, platform: "linux" }] }), /Conflicting/);
  assert.throws(() => validateWorkerDiscovery({ services: [lan, { ...lan, urls: Array.from({ length: 16 }, (_, index) => `http://10.1.1.${index + 1}:28367`) }] }), /Too many/);
});

test("explicit standard HTTP discovery port survives selection and repeated normalization; absent ports retain the app default", () => {
  const { normalizeLanControlUrl, normalizeComparableLanUrl } = loader.loadModule("src/lib/localAccess.ts");
  const url = "http://192.168.1.12:80";
  assert.equal(validateWorkerDiscovery({ services: [{ ...service(1), urls: [url] }] })[0].urls[0], url);
  assert.equal(normalizeLanControlUrl(url), `${url}/`); assert.equal(normalizeLanControlUrl(normalizeLanControlUrl(url)), `${url}/`);
  assert.equal(normalizeComparableLanUrl(url), url); assert.equal(normalizeLanControlUrl("http://192.168.1.12"), "http://192.168.1.12:28367/");
  assert.equal(normalizeLanControlUrl("http://[::1]:80"), "http://[::1]:80/");
});

function fixture(context, reply) {
  const hooks = createReactHookHarness(), calls = [];
  const modules = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@xgent/runtime": { isTauriRuntime: () => true },
    "@tauri-apps/api/core": { invoke: async (command, args) => { calls.push({ command, args }); return command === "worker_peer_discover" ? reply() : { peers: [] }; } },
  } });
  const { useWorkerPeers } = modules.loadModule("src/lib/automation/useWorkerPeers.ts");
  let enabled = true, view;
  const render = () => view = hooks.render(() => useWorkerPeers(enabled));
  context.after(() => hooks.unmount()); render();
  return { calls, render, hooks, get view() { return view; }, set enabled(value) { enabled = value; } };
}

test("explicit discovery loads five candidates, does not pair or alter saved peers, and selects only retained endpoints", async context => {
  const f = fixture(context, () => ({ services })); await settle(); f.render();
  assert.equal(f.calls.some(call => call.command === "worker_peer_discover"), false);
  const discovery = f.view.discover(); f.render(); assert.equal(f.view.busy, "discover");
  assert.equal(f.view.hasDiscoveredEndpoint(id(1), services[0].urls[0]), false);
  await discovery; f.render(); assert.deepEqual(f.view.discovered, services); assert.deepEqual(f.view.peers, []);
  assert.equal(f.view.hasDiscoveredEndpoint(id(1), services[0].urls[0]), true);
  assert.equal(f.view.hasDiscoveredEndpoint(id(1), services[1].urls[0]), false);
  assert.deepEqual(f.calls.map(call => call.command), ["worker_peer_list", "worker_peer_discover"]);
  assert.equal(f.view.discoveryAttempted, true);
});

test("late discovery cannot repopulate a retired settings view or permit stale endpoint selection", async context => {
  let release; const f = fixture(context, () => new Promise(resolve => { release = resolve; }));
  await settle(); f.render(); const discovery = f.view.discover();
  f.enabled = false; f.render(); f.enabled = true; f.render(); await settle(); f.render();
  release({ services }); await discovery; f.render();
  assert.deepEqual(f.view.discovered, []); assert.equal(f.view.discoveryAttempted, false);
  assert.equal(f.view.hasDiscoveredEndpoint(id(1), services[0].urls[0]), false); assert.equal(f.view.busy, "");
});

test("SDK permission and malformed replies retain prior observed data, expose an error and cannot fabricate discovery success", async context => {
  let fail = false; const f = fixture(context, () => { if (fail) throw new Error("Local network permission denied"); return { services }; });
  await settle(); f.render(); await f.view.discover(); f.render(); fail = true;
  await assert.rejects(f.view.discover(), /permission denied/); f.render();
  assert.deepEqual(f.view.discovered, services); assert.match(f.view.error, /permission denied/); assert.equal(f.view.busy, "");
});

test("Astryx discovered rows select the exact address, do not auto-pair, and discard retired handlers", async context => {
  const hooks = createReactHookHarness(), selected = [], calls = [];
  const modules = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "@xgent/runtime": { isTauriRuntime: () => true },
    "@tauri-apps/api/core": { invoke: async command => { calls.push(command); return command === "worker_peer_discover" ? { services } : { peers: [] }; } },
  } });
  const { useWorkerPeers } = modules.loadModule("src/lib/automation/useWorkerPeers.ts"), { WorkerPeersSection } = modules.loadModule("src/pages/settings/WorkerPeersSection.tsx");
  const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
  let active = true;
  const render = () => hooks.render(() => WorkerPeersSection({ workers: useWorkerPeers(active), disabled: false, selectDiscovered: (hostId, url) => selected.push({ hostId, url }) }));
  context.after(() => hooks.unmount()); render(); await settle();
  const scan = walk(render()).find(node => node.props?.label === "settings.workerDiscoveryScan"); scan.props.onClick(); await settle();
  const rows = walk(render()).filter(node => node.props?.label?.includes("11111111")); assert.equal(rows.length, 5);
  rows[2].props.onClick(); assert.deepEqual(selected, [{ hostId: id(3), url: services[2].urls[0] }]);
  assert.ok(!calls.includes("lan_pc_pair")); active = false; render(); rows[3].props.onClick(); assert.equal(selected.length, 1);
});

test("SwiftUI shared navigation rows fill the existing form and clear an old pairing code before a new destination", async context => {
  const hooks = createReactHookHarness(), calls = [];
  const modules = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@tauri-apps/api/core": { invoke: async command => command === "worker_peer_discover" ? { services } : { peers: [] } },
    "@xgent/runtime": { isTauriRuntime: () => true, listen: async () => () => {}, invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "cloud_secret_vault_status") return { githubTokenConfigured: false };
      if (command === "local_access_status") return { enabled: false, running: false, urls: [], devices: [], pairedDevices: 0 };
      throw new Error(`Unexpected ${command}`);
    } },
    "../lib/browser/browserSessionController": { browserSessionController: {} },
  } });
  const { useNativeAccessSettings } = modules.loadModule("src/presentation/nativeAccessSettings.ts"), { getDefaultSettings } = modules.loadModule("src/lib/settings/index.ts");
  let settings = getDefaultSettings();
  const render = () => hooks.render(() => useNativeAccessSettings({ settings, setSettings: next => { settings = next(settings); } }, true, false, key => key, () => {}));
  const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);
  context.after(() => hooks.unmount()); render(); await settle();
  let state = render(); state.handlers.get(walk(state.nodes).find(node => node.id === "worker-pair-code").action).run("123456"); state = render();
  const scan = walk(state.nodes).find(node => node.id === "worker-discovery-scan"); await state.handlers.get(scan.action).run(null); state = render();
  const rows = walk(state.nodes).filter(node => node.id?.startsWith("worker-discovery:") && node.kind === "NavigationRow"); assert.equal(rows.length, 5);
  state.handlers.get(rows[4].action).run(null); state = render();
  assert.equal(settings.access.lanControlUrl, services[4].urls[0]); assert.equal(walk(state.nodes).find(node => node.id === "worker-pair-code").value, "");
  assert.ok(!calls.some(call => call.command === "lan_pc_pair"));
});

test("native adapters use bounded real service discovery and preserve pairing/credential/task boundaries", () => {
  const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const desktop = read("src-tauri/src/services/worker_discovery.rs"), server = read("src-tauri/src/services/local_access.rs"), command = read("src-tauri/src/commands/integration/lan_pc.rs"), lib = read("src-tauri/src/lib.rs");
  assert.match(desktop, /daemon.browse\("_xgent\._tcp\.local\."\)/); assert.match(desktop, /ServiceEvent::ServiceResolved/); assert.match(desktop, /from_secs\(3\)/); assert.match(desktop, /found.len\(\)<64/); assert.match(desktop, /try_acquire_owned/);
  assert.match(desktop, /impl Drop for Advertisement[\s\S]*unregister[\s\S]*shutdown/); assert.match(desktop, /enable_addr_auto/);
  assert.match(server, /listener[\s\S]*local_addr\(\)[\s\S]*let _advertisement=if address.ip\(\).is_unspecified\(\)/);
  assert.match(command, /worker_peer_discover[\s\S]*window.label\(\)=="agent-worker"/);
  assert.equal(lib.split("commands::lan_pc::worker_peer_discover,").length - 1, 2);
  assert.doesNotMatch(desktop, /remember_client|bind_request|session_token|csrf_token|submit_background_task/);
  const ios = readFileSync(new URL("../../../mobile-assistant/ios/Sources/WorkstationDiscovery.swift", import.meta.url), "utf8"), android = readFileSync(new URL("../../../mobile-assistant/android/src/main/java/com/ohi/xgent/mobileassistant/WorkstationDiscovery.kt", import.meta.url), "utf8");
  assert.match(ios, /bonjourWithTXTRecord/); assert.match(ios, /remoteEndpoint/); assert.match(ios, /browser.cancel\(\)/); assert.match(ios, /connections.values.forEach/); assert.match(ios, /case \.waiting/);
  assert.match(ios, /guard let self, let connection, !self.finished, self.connections\[id\] === connection else/);
  assert.match(android, /manager.discoverServices/); assert.match(android, /manager.resolveService/); assert.match(android, /stopServiceDiscovery/); assert.match(android, /isSiteLocalAddress/);
  assert.doesNotMatch(ios + android, /sessionToken|csrfToken|apiKey|submit_background/);
});

test("desktop DNS-SD is pinned and locked with verified registry checksums, without mobile dependency or invented existing graph", () => {
  const lock = readFileSync(new URL("../../../../Cargo.lock", import.meta.url), "utf8");
  const expected = { "mdns-sd": "f43e377ae111ceb4630fc8239cf7af8c894193f02bb23976177a475007977417", flume: "da0e4dd2a88388a1f4ccc7c9ce104604dab68d9f408dc34cd45823d5a9069095", "socket-pktinfo": "927136cc2ae6a1b0e66ac6b1210902b75c3f726db004a73bc18686dcd0dcd22f", spin: "6980e8d7511241f8acf4aebddbb1ff938df5eebe98691418c4468d0b72a96a67" };
  for (const [name, checksum] of Object.entries(expected)) {
    const block = lock.split("[[package]]").find(block => block.includes(`name = "${name}"`)); assert.ok(block, name); assert.ok(block.includes(`checksum = "${checksum}"`));
    const deps = block.match(/dependencies = \[([\s\S]*?)\]/)?.[1].match(/"([^"\n]+)"/g) ?? [];
    for (const dependency of deps) { const raw = dependency.slice(1, -1), [dep, version] = raw.split(" "); assert.ok(lock.split("[[package]]").some(pkg => pkg.includes(`name = "${dep}"`) && (!version || pkg.includes(`version = "${version}"`))), raw); }
  }
  const manifest = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
  assert.match(manifest, /cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)[\s\S]*mdns-sd = \{ version = "=0.17.1", default-features = false \}/);
});
