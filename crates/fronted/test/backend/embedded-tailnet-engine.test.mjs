import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source contract checks, not native compilation or an actual tailnet session.
const read = name => readFileSync(new URL(`../../src-tauri/${name}`, import.meta.url), "utf8");
test("the app pins the reviewed GeiserX engine and removes the unrelated official netmon patch from resolution", () => {
  assert.match(read("Cargo.toml"), /tailscale = \{ package = "geiserx_tailscale", git = "https:\/\/github.com\/GeiserX\/tailscale-rs", rev = "eabd2cf2b810d18881c9cf305000d6f42aacbd19", features = \["axum"\] \}/);
  const root = readFileSync(new URL("../../../../Cargo.toml", import.meta.url), "utf8");
  assert.doesNotMatch(root, /ts_netmon =/);
  const engine = read("src/services/embedded_tailnet.rs"), transport = read("src/services/embedded_tailnet/transport.rs");
  assert.match(engine, /TS_RS_EXPERIMENT/); assert.match(engine, /device\.device_state\(\)/);
  assert.doesNotMatch(engine + transport, /is_authorized|AuthState/);
  assert.match(engine, /reauth_on_expiry: false/); assert.match(engine, /accept_dns: false/);
  assert.match(engine, /network::monitor\(&device, retired\)/);
});

test("network changes retain original keys and sockets while rebind failure remains retryable and shutdown owns the monitor", () => {
  const source = read("src/services/embedded_tailnet/network.rs");
  assert.match(source, /spawn_blocking\(snapshot\)/); assert.match(source, /device\.rebind\(\)/);
  assert.match(source, /if !rebound \{ continue; \}/);
  assert.match(source, /rebind_pending \|= changed \|\| resumed/);
  assert.match(source, /if !rebound \{ continue; \}\s+rebind_pending = false/);
  assert.match(source, /stop.changed\(\) => return/);
  assert.match(source, /device.watch_state\(\)/); assert.match(source, /DeviceState::Failed\(_\) \| tailscale::DeviceState::Expired/);
  assert.doesNotMatch(source, /Device::new|auth_key|initialize\(|submit_background|registry.invoke/);
});

test("discovery uses actual peer metadata and bounded read-only presence, without pairing or credential propagation", () => {
  const source = read("src/services/embedded_tailnet/discovery.rs");
  assert.match(source, /session.device.status\(\)/); assert.match(source, /node.expired/);
  assert.match(source, /own.contains\(ip\)/); assert.match(source, /take\(64\)/); assert.match(source, /buffer_unordered\(16\)/);
  assert.match(source, /application\(&node.display_name\)/); assert.match(source, /id != expected_host/);
  assert.match(source, /http:\/\/\{ip\}:\{port\}/);
  assert.match(source, /no_proxy\(\)/); assert.match(source, /redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(source, /timeout_at\(until, responses.next\(\)\)/);
  assert.match(source, /bytes.len\(\) \+ chunk.len\(\) > 4096/);
  assert.match(source, /session.stop.borrow\(\)/); assert.match(source, /is_tailnet_ipv4\(ip\)/);
  assert.doesNotMatch(source, /\.post\(|session_token|csrf_token|remember|bind_request|submit_background/);
  const discovery = read("src/services/worker_discovery.rs");
  assert.match(discovery, /tokio::join!\(discover_lan\(app\),super::embedded_tailnet::discover_workers\(\)\)/);
  assert.match(discovery, /previous.urls.extend\(service.urls\)/);
  const server = read("src/services/local_access.rs"), status = server.slice(server.indexOf("async fn public_status("), server.indexOf("async fn pair_device("));
  assert.match(status, /background_worker_identity\(\)/); assert.match(status, /"platform": std::env::consts::OS/);
  assert.doesNotMatch(status, /session_token|csrf_token|providers|workdir/);
});

// Retiring only Engine.live leaves outstanding Session owners alive indefinitely.
test("terminal SDK states cancel all socket owners before shutdown and retain actionable status", () => {
  const source = read("src/services/embedded_tailnet.rs");
  const terminal = source.indexOf('let state = device.device_state()', source.indexOf('let monitor = network::monitor'));
  const signal = source.indexOf('retire.send_replace(true)', terminal);
  const clear = source.indexOf('owner.live.send_replace(None)', signal);
  const drain = source.indexOf('Arc::try_unwrap(device)', clear);
  assert.ok(terminal > 0 && signal > terminal && clear > signal && drain > clear);
  assert.match(source, /DeviceState::NeedsMachineAuth => "approval-required"/);
  assert.match(source, /DeviceState::NeedsLogin\(_\) \| tailscale::DeviceState::Expired => "login-required"/);
  assert.match(source, /Err\(_\) => \{ owner.state.send_replace\("offline"\); return; \}/);
  assert.match(source, /status.state = \(\*owner.state.borrow\(\)\).into\(\)/);
});

test("typed network registration failure retires one attempt and retries with original configuration, without replaying OAuth or application work", () => {
  const source = read("src/services/embedded_tailnet.rs");
  const policy = read("src/services/embedded_tailnet/lifecycle.rs");
  const launch = source.slice(source.indexOf('fn launch('), source.indexOf('pub(crate) async fn authenticate'));
  assert.match(policy, /NetworkUnreachable \| RegistrationError::Timeout\) => Some\(Exit::Retry\)/);
  assert.match(policy, /AuthRejected/);
  assert.ok(launch.indexOf('let config =') < launch.indexOf('loop {'));
  assert.match(launch, /Device::new_with_secret\(&config, auth_key.clone\(\)\)/);
  assert.match(launch, /auth_key = None/);
  assert.match(launch, /if !retry \|\| \*stopped.borrow\(\) \{ break; \}/);
  assert.ok(launch.indexOf('device.shutdown(') < launch.indexOf('backoff.next()'));
  assert.doesNotMatch(launch, /oauth::|registry.invoke|submit_background|Default::default\(\).*keys/);
});

test("server identity admission has no system-client or NIC fallback", () => {
  const source = read("src/services/local_access.rs");
  const gate = source.slice(source.indexOf('fn is_allowed_tailscale_host('), source.indexOf('fn is_allowed_host_for_addresses('));
  assert.match(gate, /observed.engine.as_deref\(\) != Some\("embedded-rust"\)/);
  assert.doesNotMatch(gate, /local_addresses|lan_ipv4_addresses|local_addresses.contains/);
  const ranking = source.slice(source.indexOf('fn rank_lan_addresses('), source.indexOf('fn lan_interface_score('));
  assert.match(ranking, /if !ip.is_private\(\)/);
  assert.doesNotMatch(ranking, /is_tailnet_ipv4/);
});

test("the SDK Axum listener serves the original router and preserves per-device peer identity", () => {
  const transport = read("src/services/embedded_tailnet/transport.rs");
  const serving = transport.slice(transport.indexOf('async fn serve_listener('), transport.indexOf('#[cfg(test)]'));
  assert.match(serving, /tailscale::axum::Listener::from\(listener\)/);
  assert.match(serving, /axum::serve\(listener, router.into_make_service_with_connect_info::<LocalAccessPeerAddr>\(\)\)/);
  assert.doesNotMatch(serving, /TcpStream::connect|copy_bidirectional|forward_listener/);
  const server = read("src/services/local_access.rs");
  assert.match(server, /serve_worker\(actual.port\(\), identity, router\)/);
  assert.match(server, /Connected<axum::serve::IncomingStream<'_, tailscale::axum::Listener>> for LocalAccessPeerAddr/);
  assert.match(server, /ConnectInfo\(LocalAccessPeerAddr\(remote\)\)/);
  assert.match(server, /record_pair_attempt\(remote.ip\(\)\)/);
});

test("ordinary app/LAN startup is independent of overlay proxy initialization", () => {
  const source = read("src/services/lan_pc_client.rs");
  const startup = source.slice(source.indexOf('pub(crate) fn new_with_namespace('), source.indexOf('fn http_builder('));
  assert.doesNotMatch(startup, /embedded_tailnet::with_proxy|http_for\(/);
  const routing = source.slice(source.indexOf('fn http_for('), source.indexOf('pub async fn status('));
  assert.match(routing, /if !super::embedded_tailnet::uses_transport\(base_url\)/);
  assert.match(routing, /return Ok\(if events \{ &self.event_http \} else \{ &self.http \}\)/);
  assert.match(routing, /with_proxy\(Self::http_builder\(events\)\)\?/);
  assert.doesNotMatch(routing, /\.unwrap_or|\.or_else/);
  // Authentication repair adds another subscription request. Every request
  // must still use endpoint-aware routing, including that repair branch.
  assert.doesNotMatch(source, /self\s*\.(?:http|event_http)\s*\.(?:get|post|delete|request)\(/);
  assert.match(source, /response = self\.http_for\(&session\.base_url, false\)\?/);
  const proxy = read("src/services/embedded_tailnet/transport.rs");
  assert.match(proxy, /static GATE: Mutex<Option<Gate>>/);
  assert.ok(proxy.indexOf('TcpListener::bind') < proxy.indexOf('*gate = Some(Gate { url })'));
});

test("OS LAN result reads do not initialize the optional overlay proxy", () => {
  const source = read("src/services/os_result_receiver.rs");
  const startup = source.slice(source.indexOf('pub(super) fn sync('), source.indexOf('#[cfg(target_os="android")]\npub extern'));
  assert.doesNotMatch(startup, /with_blocking_proxy/);
  const routes = source.slice(source.indexOf('fn read_target('), source.indexOf('pub(super) fn sync('));
  assert.match(routes, /let client = if overlay/);
  assert.match(routes, /Err\(_\) => continue/);
  assert.match(routes, /else \{ client \}/);
});
