import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function fixture(owner) {
  const calls = [], local = [];
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push({ command, args });
      return command === "worker_peer_resolve_request" ? owner : { actual: true };
    } },
    "@xgent/runtime": { isTauriRuntime: () => true, invoke: () => assert.fail("Mutable global port used"), getLanPcCommandHostConfig: () => ({ enabled: false }) },
  } });
  const { createAutomationBackend } = loader.loadModule("src/lib/automation/backend.ts");
  const backend = createAutomationBackend({ async invoke(command, args) { local.push({ command, args }); return { actual: true }; }, async listen() {} });
  return { calls, local, backend };
}

test("child summary reads resolve the original parent's persisted host, retaining chunk identity", async () => {
  const f = fixture("original-peer"), hash = "a".repeat(64);
  assert.deepEqual(await f.backend.readBackgroundChildren("parent", undefined, "child-call", 8192, hash), { actual: true });
  assert.deepEqual(f.calls, [
    { command: "worker_peer_resolve_request", args: { request_id: "parent" } },
    { command: "worker_peer_invoke", args: { peer_id: "original-peer", command: "automation_background_children", args: { request_id: "parent", call_id: "child-call", offset: 8192, snapshot_hash: hash } } },
  ]);
  assert.equal(f.local.length, 0);
});

test("a native parent's child read uses the captured command port and never turns into a submission", async () => {
  const f = fixture(null); await f.backend.readBackgroundChildren("native-parent");
  assert.deepEqual(f.local, [{ command: "automation_background_children", args: { request_id: "native-parent", call_id: undefined, offset: 0, snapshot_hash: undefined } }]);
  assert.equal(f.calls.length, 1);
});

test("child wait uses native execution authority even when a task port points at a remote host", async () => {
  const f = fixture("remote"), lease = { attempt: 1, generation: 2, token: "native-token" };
  await f.backend.recordBackgroundChildWait("execution", "slides", "actual-submit", "Actual work pending", lease);
  assert.deepEqual(f.calls, [{ command: "automation_background_child_wait", args: { execution_id: "execution", branch_id: "slides", call_id: "actual-submit", reason: "Actual work pending", lease } }]);
  assert.equal(f.local.length, 0);
});

test("child acceptance parking uses native execution authority and captured lease, never a mutable remote task port", async () => {
  const f = fixture("remote"), lease = { attempt: 1, generation: 2, token: "native-token" };
  await f.backend.parkUnconfirmedChildStart("execution", "original-submit", lease);
  assert.deepEqual(f.calls, [{ command: "automation_background_child_park", args: { execution_id: "execution", call_id: "original-submit", lease } }]);
  assert.equal(f.local.length, 0);
});


test("persistent model submit bypasses a mutable remote command port and passes only frozen native authority plus exact model",async()=>{
  const f=fixture("remote"), lease={attempt:1,generation:2,token:"actual-token"};
  await f.backend.submitBackgroundModelTask("execution","call",lease,"configured-provider","configured-model");
  assert.deepEqual(f.calls,[{command:"automation_background_model_submit",args:{execution_id:"execution",call_id:"call",lease,provider_id:"configured-provider",model:"configured-model"}}]);
  assert.equal(f.local.length,0);
});
