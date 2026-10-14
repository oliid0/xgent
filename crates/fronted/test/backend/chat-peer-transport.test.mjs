import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL("../../src-tauri/src/" + file, import.meta.url), "utf8");

// Native source wiring checks; these do not execute Rust or simulate a tailnet.
test("interactive commands use protected peer selection before a single actual dispatch", () => {
  const commands = read("commands/integration/lan_pc.rs");
  assert.match(commands, /registry\.invoke_chat\(&url, peer_id\.as_deref\(\), &command, args\)\.await/);
  assert.match(commands, /registry\.unsubscribe_chat\(&subscription_id\)\.await/);
  const chat = read("services/worker_peers/chat.rs");
  const invoke = chat.split("pub async fn invoke_chat(")[1].split("pub async fn subscribe_chat(")[0];
  assert.match(invoke, /Some\(id\) => id\.to_string\(\)/);
  assert.match(invoke, /self\.resolve_endpoint\(base_url\)\.await\?/);
  assert.equal(invoke.split("client.invoke(").length - 1, 1);
  assert.doesNotMatch(invoke, /loop|while|\.or_else/);
  assert.match(chat, /Self::probe_entry\(&stored, &clients\)\.await/);
  assert.match(chat, /known\.session_id == endpoint\.session_id/);
  assert.match(chat, /Arc::ptr_eq\(owner, &client\)/);
  assert.match(read("services/worker_peers.rs"), /\/\/\/ Observe paired virtual-network services, not VPN ownership\/readiness\.\s+async fn probe_entry/);
});

test("native stream closure has a deadline and cleanup uses its captured session", () => {
  const client = read("services/lan_pc_client.rs");
  const cleanup = client.split("pub async fn unsubscribe(")[1].split("async fn session_snapshot(")[0];
  assert.match(cleanup, /let captured = subscription\.session\.clone\(\);\s+subscription\.stop\(\)/);
  assert.match(cleanup, /filter\(\|current\| same_session\(current, &captured\)\)\.cloned\(\)\.unwrap_or\(captured\.clone\(\)\)/);
  assert.match(cleanup, /is_some_and\(\|current\| same_session\(current, &captured\)\)/);
  assert.match(client, /timeout\(Duration::from_secs\(45\), stream\.next\(\)\)/);
  assert.match(client, /subscription_id: task_relay_id, payload: Value::Null, closed: true/);
  assert.match(client, /buffer\.extend_from_slice\(&chunk\)/);
  assert.doesNotMatch(client, /from_utf8_lossy\(&chunk\)/);
  assert.match(client, /pub\(crate\) async fn retire/);
  assert.match(client, /if envelope\.session_revoked \{ break 'events; \}/);
});

test("subscription handshake and authentication repair are bounded without write replay", () => {
  const client = read("services/lan_pc_client.rs");
  const subscribe = client.split("pub async fn subscribe(")[1].split("pub async fn unsubscribe(")[0];
  assert.match(subscribe, /let _refresh_guard = self\.refresh_lock\.lock\(\)\.await/);
  assert.match(subscribe, /timeout\(Duration::from_secs\(8\), self/);
  assert.match(subscribe, /if response\.status\(\)\.as_u16\(\) == 401/);
  assert.equal(subscribe.split('.json(&json!({ "event": event, "streamId": relay_id }))').length - 1, 2);
  assert.equal(subscribe.split('.timeout(Duration::from_secs(8))').length - 1, 2);
  const stop = client.split("impl EventSubscription {")[1].split("pub struct LanPcClient")[0];
  assert.match(stop, /self\.task\.abort\(\)/);
  assert.match(stop, /subscription_id: self\.relay_id, payload: Value::Null, closed: true/);
  for (const method of ["disconnect", "retire"]) {
    assert.match(client.split(`async fn ${method}(`)[1].split("pub async fn")[0], /subscription\.stop\(\)/);
  }
});

test("native stream lifetimes own only their authenticated subscriptions", () => {
  const source = read("services/local_access.rs");
  const stream = source.split("async fn event_stream(")[1].split("async fn subscribe_event(")[0];
  assert.match(stream, /Query\(query\): Query<EventStreamQuery>/);
  assert.match(stream, /streams\.insert\(stream_id\.clone\(\), device_id\.clone\(\)\)/);
  assert.match(stream, /stream::unfold\(\(receiver, guard\)/);
  const subscribe = source.split("async fn subscribe_event(")[1].split("async fn unsubscribe_event(")[0];
  assert.match(subscribe, /streams\.get\(id\) != Some\(&session\.device_id\)/);
  assert.ok(subscribe.indexOf("controller.event_streams.lock()") < subscribe.indexOf("subscriptions.insert"));
  const cleanup = source.split("impl Drop for EventStreamGuard")[1].split("struct LocalEventSubscriptionRequest")[0];
  assert.match(cleanup, /subscription\.stream_id\.as_deref\(\) == Some\(&self\.stream_id\)/);
  assert.doesNotMatch(cleanup, /remove_device_subscriptions/);
  assert.match(read("services/lan_pc_client.rs"), /\.query\(&\[\("streamId", &relay_id\)\]\)/);
});
