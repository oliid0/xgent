import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These assertions inspect the native control path, not Rust/HTTP execution.
// Four mobile Rust tests use actual HTTP, scoped HMAC and native inbox APIs.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = read("services/os_result_receiver.rs").split("#[cfg(test)]")[0];
const target = source.slice(source.indexOf("fn read_target"), source.indexOf("pub(super) fn sync"));
test("rejected original route replies continue to the next scoped route without poisoning successful fallback", () => {
  assert.match(target, /for endpoint in &target.endpoints/);
  assert.match(target, /let Some\(signature\)[^]*?else \{continue;\}/);
  assert.match(target, /verify_result_reply_proof\(&key,&nonce,&bytes,&signature\).is_err\(\)\{continue;\}/);
  assert.match(target, /packet\["snapshot"\]\["requestId"\]!=target.request_id \{continue;\}/);
  assert.match(target, /receive_background_result_guarded[^]*?\.is_err\(\)\{continue;\}/);
  assert.match(target, /return Ok\(true\);[^]*?Ok\(false\)/);
  assert.doesNotMatch(target, /unresolved|continue 'targets|break;/);
  assert.match(source, /unresolved\|=!read_target\(&client,&store,&target,host,started,budget,stopped\)\?/);
});
test("each fallback keeps the same original host/request and independently validates its session, nonce, bytes and current scope", () => {
  assert.match(target, /target.binding_hash\(\)\?/);
  assert.match(target, /Sha256::digest\(endpoint.token.as_bytes\(\)\)/);
  assert.match(target, /result_read_proof\(&key,&target.source_host_id,host,&endpoint.session_id,&target.request_id,&nonce\)/);
  assert.match(target, /packet\["receiverHostId"\]!=host/);
  assert.match(target, /packet\["sessionId"\]!=endpoint.session_id/);
  assert.match(target, /packet\["snapshot"\]\["hostId"\]!=target.source_host_id/);
  assert.ok(target.indexOf("verify_result_reply_proof") < target.indexOf("serde_json::from_slice"));
  assert.match(target, /Some\(\(host,&binding\)\),stopped/);
  assert.equal((target.match(/endpoint.expires_at<=/g) ?? []).length, 2);
  assert.equal((target.match(/started.elapsed\(\)>=budget/g) ?? []).length, 3);
  assert.match(target, /wait_ready_for_os\(\)/);
  assert.match(target, /began.elapsed\(\)>=Duration::from_secs\(20\)/);
  assert.doesNotMatch(source, /automation_background_submit|resume_background|acknowledge_background_inbox|permission_request|authorization/);
});
test("shared iOS/Android entry points retain bounded GET-only native intake and durable retries", () => {
  assert.match(source, /client.get\(url\)/); assert.doesNotMatch(source, /client.post|client.put|client.delete/);
  assert.match(source, /\.no_proxy\(\)/); assert.match(source, /Policy::none/); assert.match(source, /retry::never/);
  assert.match(source, /MAX_BODY\+1/); assert.match(source, /claimed.is_empty\(\)/);
  assert.match(source, /claim_os_result_delivery\(host,&targets\)/);
  assert.match(source, /bounded durable retry retained/);
  assert.match(read("services/ios_result_receiver.rs"), /os_result_receiver::sync/);
  assert.match(read("services/os_result_receiver.rs"), /NativeResultReceiver_sync/);
});
