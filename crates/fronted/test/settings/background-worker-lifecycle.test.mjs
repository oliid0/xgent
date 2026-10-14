import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function worker(t, options = {}) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const calls = [], starts = [], stops = [];
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push({ command, args });
      if (args?.running) await options.heartbeat?.();
    } },
    "./localAccessHostBridge": { async startLocalAccessHostBridge() {
      starts.push("bridge");
      await options.bridge?.();
      return () => stops.push("bridge");
    } },
    "../lib/automation/backend": { createAutomationBackend: transport => ({
      claim: args => transport.invoke("automation_claim_prompt_runs", args),
    }) },
    "../lib/automation/promptRunHost": { startPromptRunHost(ports) {
      starts.push("prompts"); options.capture?.(ports);
      return () => stops.push("prompts");
    } },
    "../lib/automation/backgroundWaitReconciler": { startBackgroundWaitReconciler() {
      starts.push("waits");
      return () => stops.push("waits");
    } },
    "../lib/settings/storage": { async loadPersistedSettings() { return { source: "this-installation" }; } },
    "../lib/automation/promptExecution": { async executeCronPromptRun(settings, request, signal) {
      calls.push({ settings, request, signal }); return "verified local result";
    } },
  } });
  const stop = loader.loadModule("src/runtime/agentWorker.ts").startAgentWorker("test-instance");
  t.after(stop);
  return { calls, starts, stops, stop };
}

test("single-device worker executes with persisted local settings without pairing or a chat component", async t => {
  let ports;
  const h = worker(t, { capture(value) { ports = value; } }); await flush();
  assert.deepEqual(h.starts, ["bridge", "prompts", "waits"]);
  const request = { executionId: "local" }, signal = new AbortController().signal;
  assert.equal(await ports.execute(request, signal), "verified local result");
  assert.deepEqual(h.calls.at(-1), { settings: { source: "this-installation" }, request, signal });
  t.mock.timers.tick(15_000); await flush();
  assert.deepEqual(h.starts, ["bridge", "prompts", "waits"]);
  h.stop(); h.stop();
  assert.deepEqual(h.stops, ["bridge", "prompts", "waits"]);
  assert.equal(h.calls.at(-1).args.running, false);
});

test("worker claims and shutdown carry the captured instance even when caller arguments try to replace it", async t => {
  let ports;
  const h = worker(t, { capture(value) { ports = value; } }); await flush();
  assert.equal(h.calls[0].args.worker_instance_id, "test-instance");
  await ports.claim({ limit: 2, worker_instance_id: "replacement" });
  assert.deepEqual(h.calls.at(-1), { command: "automation_claim_prompt_runs", args: { limit: 2, worker_instance_id: "test-instance" } });
  h.stop(); await flush();
  assert.deepEqual(h.calls.at(-1).args, { running: false, worker_instance_id: "test-instance" });
});

for (const afterStart of [false, true]) {
  test(`superseded worker stops all acquired hosts and retry timers (${afterStart ? "running" : "startup"})`, async t => {
    let superseded = !afterStart;
    const h = worker(t, { async heartbeat() {
      if (superseded) throw new Error("Background worker instance was superseded");
    } });
    await flush();
    if (afterStart) { superseded = true; t.mock.timers.tick(5_000); await flush(); }
    assert.deepEqual(h.stops, afterStart ? ["bridge", "prompts", "waits"] : ["bridge"]);
    const count = h.calls.length; t.mock.timers.tick(30_000); await flush(); h.stop();
    assert.equal(h.calls.length, count);
    assert.deepEqual(h.calls.at(-1).args, { running: false, worker_instance_id: "test-instance" });
  });
}

test("bridge startup failure retries independently without blocking or restarting autonomous execution", async t => {
  let attempts = 0;
  const h = worker(t, { async bridge() { if (++attempts === 1) throw new Error("listener unavailable"); } });
  await flush(); assert.deepEqual(h.starts, ["bridge", "prompts", "waits"]);
  t.mock.timers.tick(5_000); await flush();
  assert.deepEqual(h.starts, ["bridge", "prompts", "waits", "bridge"]);
  assert.equal(h.stops.length, 0);
});

test("failed native recovery never starts task claims and does not remove the existing RPC bridge", async t => {
  let unavailable = true;
  const h = worker(t, { async heartbeat() { if (unavailable) throw new Error("recovery unfinished"); } });
  await flush(); assert.deepEqual(h.starts, ["bridge"]);
  t.mock.timers.tick(5_000); await flush(); assert.deepEqual(h.starts, ["bridge"]);
  unavailable = false; t.mock.timers.tick(5_000); await flush();
  assert.deepEqual(h.starts, ["bridge", "prompts", "waits"]);
  unavailable = true; t.mock.timers.tick(5_000); await flush();
  assert.deepEqual(h.stops, []); // A lost later heartbeat does not replay or abort active tools.
});

test("slow startup has one attempt per component and shutdown fences late readiness", async t => {
  const bridge = deferred(), heartbeat = deferred();
  const h = worker(t, { bridge: () => bridge.promise, heartbeat: () => heartbeat.promise });
  await flush(); t.mock.timers.tick(15_000); await flush();
  assert.deepEqual(h.starts, ["bridge"]); assert.equal(h.calls.length, 1);
  h.stop(); bridge.resolve(); heartbeat.resolve(); await flush();
  assert.deepEqual(h.starts, ["bridge"]); assert.deepEqual(h.stops, ["bridge"]);
  assert.equal(h.calls.at(-1).args.running, false);
  const count = h.calls.length; t.mock.timers.tick(15_000); await flush(); assert.equal(h.calls.length, count);
});

test("an aborted local execution does not call the model after loading settings", async t => {
  let ports;
  const h = worker(t, { capture(value) { ports = value; } }); await flush();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(ports.execute({ executionId: "cancelled" }, controller.signal), /abort/i);
  assert.equal(h.calls.some(call => call.settings), false);
});

test("partial bridge registration cleans prior RPC and late subscriptions before a retry", async () => {
  const listeners = new Map(), removals = [], writes = [], pending = deferred();
  let failed = false;
  const loader = createTsModuleLoader({ mocks: {
    "./tauri": { createTauriRuntime: () => ({
      async invoke(command, args) { writes.push({ command, args }); return "real receipt"; },
      async listen(event, handler) {
        if (event === "workspace:activity") return pending.promise;
        if (event === "local-access:event-unsubscribe" && !failed) {
          failed = true;
          listeners.get("local-access:event-subscribe")({ payload: { subscriptionId: "in-flight", event: "workspace:activity" } });
          throw new Error("subscription registration failed");
        }
        listeners.set(event, handler);
        return () => { removals.push(event); listeners.delete(event); };
      },
    }) },
  } });
  const api = loader.loadModule("src/runtime/localAccessHostBridge.ts");
  await assert.rejects(api.startLocalAccessHostBridge(), /registration failed/);
  assert.equal(listeners.size, 0);
  pending.resolve(() => removals.push("late forwarded listener")); await flush();
  assert.ok(removals.includes("late forwarded listener"));
  const stop = await api.startLocalAccessHostBridge();
  listeners.get("local-access:rpc-request")({ payload: { requestId: "one", command: "fs_write_text", args: { content: "one real write" } } });
  await flush();
  assert.deepEqual(writes.map(call => call.command), ["fs_write_text", "local_access_rpc_respond"]);
  assert.equal(writes[1].args.result, "real receipt");
  stop(); stop(); assert.equal(listeners.size, 0);
});
