import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const clocked = new WeakSet();
const task = (id, overrides = {}) => ({ executionId: id, waiting: { waitId: `wait-${id}`, automaticTools: ["Calendar"], knownTools: ["Read"], retryOnInventoryChange: false, ...overrides } });
function setup(t, options = {}) {
  if (!clocked.has(t)) { t.mock.timers.enable({ apis: ["setInterval"] }); clocked.add(t); }
  const calls = [], wakes = [], registry = [];
  const snapshot = { providerId: "accepted", providers: [{ id: "accepted", type: "openai" }], system: { workdir: "/accepted", selectedSystemTools: [] }, mcp: [], access: {} };
  const backend = {
    async loadWaitingExecutionSettings(id, waitId) { calls.push(["settings", id, waitId]); if (options.revoked) throw new Error("secret account changed"); return snapshot; },
  };
  const api = createTsModuleLoader({ mocks: {
    "./backend": { backend }, "../runtimePlatform": { resolveRuntimePlatform: async () => "windows" },
    "../settings": { normalizeSettings: (value) => value, resolveWorkspaceResources: () => ({}), filterMcpSettingsForWorkspace: (value) => value },
    "../settings/storage": { loadPersistedSettings: async () => ({ system: { workdir: "/stale" } }) },
    "../tools/fileToolState": { createFileToolState: () => ({}) },
    "../tools/builtinRegistry": { async buildBuiltinToolRegistry(params) { registry.push(params); return { tools: [{ name: "Read" }, { name: "Calendar" }] }; } },
  } }).loadModule("src/lib/automation/backgroundWaitReconciler.ts");
  const ports = {
    async probeBackgroundCloudWait(id,waitId,callId){calls.push(["cloud-probe",id,waitId,callId]);return await options.probe?.(id,waitId,callId)??false;},
    async dueBackgroundWaits() { calls.push(["due"]); return options.tasks ?? [task("one")]; },
    async deferBackgroundWait(id, waitId) { calls.push(["defer", id, waitId]); if (options.defer) await options.defer; },
    async discoverTools(value) { calls.push(["discover", value.executionId]); if (value.executionId === "revoked") throw new Error("configuration changed"); return options.tools ?? ["Read", "Calendar"]; },
    async wakeReadyBackgroundTask(id, waitId, tools) { wakes.push({ id, waitId, tools }); return true; },
  };
  return { ...api, calls, wakes, registry, ports };
}

test("interrupted cloud collection runs without discovery or model; errors do not starve normal waits", async (t) => {
  const f = setup(t);
  f.ports.recoverInterruptedCloudLaunches = async () => { f.calls.push(["recover-starts"]); throw new Error("original configuration unavailable"); };
  const stop = f.startBackgroundWaitReconciler(f.ports); t.after(stop); await flush();
  assert.deepEqual(f.calls.slice(0, 4), [["recover-starts"], ["due"], ["defer", "one", "wait-one"], ["discover", "one"]]);
  assert.equal(f.wakes.length, 1);
});

test("remote cancellation is reconciled even with no waiting tasks; errors retain the remaining worker loop", async t => {
  const f = setup(t, { tasks: [] });
  f.ports.reconcileCloudCancellations = async () => { f.calls.push(["cancel-original"]); throw new Error("original GitHub account offline"); };
  f.ports.recoverInterruptedCloudLaunches = async () => { f.calls.push(["recover-starts"]); return 0; };
  const stop = f.startBackgroundWaitReconciler(f.ports); t.after(stop); await flush();
  assert.deepEqual(f.calls, [["cancel-original"], ["recover-starts"], ["due"]]);
  assert.equal(f.registry.length, 0); assert.equal(f.wakes.length, 0);
});

test("shutdown and overlapping ticks cannot continue recovery after an in-flight cancellation collector", async t => {
  const f = setup(t); let release;
  f.ports.reconcileCloudCancellations = () => { f.calls.push(["cancel-original"]); return new Promise(resolve => { release = resolve; }); };
  const stop = f.startBackgroundWaitReconciler(f.ports); t.after(stop); await flush();
  t.mock.timers.tick(90_000); await flush(); assert.deepEqual(f.calls, [["cancel-original"]]);
  stop(); release(0); await flush(); assert.deepEqual(f.calls, [["cancel-original"]]); assert.equal(f.wakes.length, 0);
});

test("shutdown and overlapping ticks cannot issue more probes while interrupted recovery is running", async (t) => {
  const f = setup(t); let release;
  f.ports.recoverInterruptedCloudLaunches = () => { f.calls.push(["recover-starts"]); return new Promise(resolve => { release = resolve; }); };
  const stop = f.startBackgroundWaitReconciler(f.ports); t.after(stop); await flush();
  t.mock.timers.tick(90_000); await flush(); assert.deepEqual(f.calls, [["recover-starts"]]);
  stop(); release(1); await flush(); assert.deepEqual(f.calls, [["recover-starts"]]); assert.equal(f.wakes.length, 0);
});

test("preflight loads native-bound settings and discovers real tools without executing tools or a model", async (t) => {
  const f = setup(t); assert.deepEqual(await f.discoverWaitingTools(task("one")), ["Read", "Calendar"]);
  assert.deepEqual(f.calls[0], ["settings", "one", "wait-one"]);
  assert.equal(f.registry[0].workdir, "/accepted"); assert.equal(f.registry[0].providerId, "openai");
  assert.equal(f.registry[0].mcpLoadFailureMode, "continue"); assert.equal(f.registry[0].backgroundTaskLease, undefined);
});

test("persistent backoff precedes connector discovery and wake keeps the same task occurrence", async (t) => {
  const f = setup(t); const stop = f.startBackgroundWaitReconciler(f.ports); t.after(stop); await flush();
  assert.deepEqual(f.calls.slice(0, 3), [["due"], ["defer", "one", "wait-one"], ["discover", "one"]]);
  assert.deepEqual(f.wakes, [{ id: "one", waitId: "wait-one", tools: ["Read", "Calendar"] }]);
});

test("pending Actions jobs poll after persisted backoff without discovering tools, using the model or waking",async t=>{
  const f=setup(t,{tasks:[task("cloud",{automaticTools:[],cloudCallIds:["actual-start"]})]});
  const stop=f.startBackgroundWaitReconciler(f.ports);t.after(stop);await flush();
  assert.deepEqual(f.calls,[["due"],["defer","cloud","wait-cloud"],["cloud-probe","cloud","wait-cloud","actual-start"]]);assert.deepEqual(f.wakes,[]);assert.equal(f.registry.length,0);
});

test("one native-accepted terminal cloud event resumes once; rejection does not starve other jobs or independent tasks",async t=>{
  const f=setup(t,{tasks:[task("cloud",{automaticTools:[],cloudCallIds:["revoked","completed","not-needed"]}),task("independent")],probe:async(_id,_wait,call)=>{if(call==="revoked")throw new Error("Credential changed");return call==="completed";}});
  const stop=f.startBackgroundWaitReconciler(f.ports);t.after(stop);await flush();
  assert.deepEqual(f.calls.filter(([kind])=>kind==="cloud-probe"),[["cloud-probe","cloud","wait-cloud","revoked"],["cloud-probe","cloud","wait-cloud","completed"]]);
  assert.deepEqual(f.wakes.map(value=>value.id),["independent"]);assert.equal(f.calls.some(([kind,id])=>kind==="discover"&&id==="cloud"),false);
});

test("shutdown during a cloud GET prevents additional polling, discovery and frontend wake",async t=>{
  let resolve;const f=setup(t,{tasks:[task("cloud",{cloudCallIds:["first","second"]})],probe:()=>new Promise(done=>resolve=done)});
  const stop=f.startBackgroundWaitReconciler(f.ports);await flush();stop();resolve(false);await flush();
  assert.equal(f.calls.filter(([kind])=>kind==="cloud-probe").length,1);assert.equal(f.calls.some(([kind])=>kind==="discover"),false);assert.deepEqual(f.wakes,[]);
});

test("missing or revoked capabilities leave waiting intact while independent candidates continue", async (t) => {
  const f = setup(t, { tasks: [task("revoked"), task("ready"), task("input", { automaticTools: [] })] });
  const stop = f.startBackgroundWaitReconciler(f.ports); t.after(stop); await flush();
  assert.deepEqual(f.wakes.map((wake) => wake.id), ["ready"]);
  const revoked = setup(t, { revoked: true }); await assert.rejects(revoked.discoverWaitingTools(task("revoked")), /account changed/); assert.equal(revoked.registry.length, 0);
});

test("unavailable criteria wake only on an actual newly discovered tool, not an unchanged inventory", async (t) => {
  const f = setup(t, { tasks: [task("capability", { automaticTools: [], retryOnInventoryChange: true, knownTools: ["Read"] })] });
  const stop = f.startBackgroundWaitReconciler(f.ports); t.after(stop); await flush(); assert.equal(f.wakes.length, 1);
  stop();
  const same = setup(t, { tools: ["Read"], tasks: [task("same", { automaticTools: [], retryOnInventoryChange: true })] });
  const end = same.startBackgroundWaitReconciler(same.ports); t.after(end); await flush(); assert.equal(same.wakes.length, 0);
});

test("overlapping ticks and shutdown cannot multiply a probe or wake after it was stopped", async (t) => {
  let release; const defer = new Promise((resolve) => { release = resolve; });
  const f = setup(t, { defer }); const stop = f.startBackgroundWaitReconciler(f.ports); await flush();
  t.mock.timers.tick(60_000); await flush(); assert.equal(f.calls.filter(([kind]) => kind === "due").length, 1);
  stop(); release(); await flush(); assert.equal(f.calls.some(([kind]) => kind === "discover"), false); assert.equal(f.wakes.length, 0);
});
