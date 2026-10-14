import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const loader = createTsModuleLoader();
const api = loader.loadModule("src/lib/automation/proactive.ts");
const valid = () => ({ name: "Follow-up", targetTaskId: "target", sourceTaskId: null, eventKind: "run_succeeded", cooldownMinutes: 5, maxAgeMinutes: 60, quietStart: null, quietEnd: null });
const snapshot = (revision = 0, hostId = "original-pc") => ({ revision, hostId, hostTime: "2026-10-09T10:00:00-07:00", rules: [], deliveries: [], targets: [] });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test("Home power scope uses an exact home UUID and cannot carry a task filter, Health read or metric", () => {
  const home = { ...valid(), eventKind: "home_power_changed", homeId: "11111111-1111-4111-8111-111111111111" };
  api.validateProactiveConfig(home);
  for (const config of [{ ...home, homeId: undefined }, { ...home, homeId: "Living room" }, { ...home, homeId: "AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA" },
    { ...home, sourceTaskId: "source" }, { ...home, healthMetric: "heart_rate" }, { ...home, backgroundHealthReads: true }, { ...valid(), homeId: home.homeId }])
    assert.throws(() => api.validateProactiveConfig(config));
});

test("quiet hours require exact valid times and paired boundaries; rule validation enforces bounded whole minutes", () => {
  assert.equal(api.parseQuietTime("00:00"), 0); assert.equal(api.parseQuietTime("23:59"), 1439); assert.equal(api.parseQuietTime(""), null);
  for (const time of ["24:00", "2:30", "12:60", "12:00Z", "12:00 "]) assert.throws(() => api.parseQuietTime(time));
  api.validateProactiveConfig({ ...valid(), quietStart: 1320, quietEnd: 420 });
  for (const patch of [{ cooldownMinutes: 0 }, { maxAgeMinutes: 10081 }, { cooldownMinutes: 1.5 }, { name: " " }, { sourceTaskId: "target" }, { quietStart: 10 }, { quietStart: 10, quietEnd: 10 }, { quietStart: -1, quietEnd: 60 }])
    assert.throws(() => api.validateProactiveConfig({ ...valid(), ...patch }));
  assert.deepEqual(api.eligibleProactiveTargets([{ id: "a", type: "prompt", enabled: true }, { id: "b", type: "bash", enabled: true }, { id: "c", type: "prompt", enabled: false }, { id: "d", type: "prompt", enabled: true, remainingExecutions: 0 }]).map(t => t.id), ["a"]);
});

test("background health samples require explicit boolean opt-in, supported metric and selected remote executor", () => {
  const remoteExecution = { peerId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", providerId: "actual", model: "actual", workdir: "/real" };
  const health = { ...valid(), eventKind: "health_updated", healthMetric: "heart_rate", remoteExecution };
  api.validateProactiveConfig(health); api.validateProactiveConfig({ ...health, backgroundHealthReads: true });
  api.validateProactiveConfig({ ...valid(), backgroundHealthReads: false });
  for (const config of [{ ...valid(), backgroundHealthReads: true }, { ...health, remoteExecution: null, backgroundHealthReads: true },
    { ...health, backgroundHealthReads: "true" }, { ...health, healthMetric: "unsupported", backgroundHealthReads: true }])
    assert.throws(() => api.validateProactiveConfig(config));
});

test("receipts display actual joined execution state and never promote queue acceptance to successful work", () => {
  for (const [runState, runSuccess, expected] of [["pending", false, "queued"], ["leased", false, "running"], ["done", true, "done"], ["done", false, "failed"], ["expired", false, "expired"], [null, null, "unavailable"]])
    assert.equal(api.proactiveDeliveryStatus({ state: "queued", runState, runSuccess }), `proactive.state.${expected}`);
  assert.equal(api.proactiveDeliveryStatus({ state: "revoked", runState: "done", runSuccess: true }), "proactive.state.revoked");
});

test("health scope requires an actual supported metric, excludes task status filters and cannot leak to ordinary rules", () => {
  for (const metric of api.HEALTH_UPDATE_METRICS)
    api.validateProactiveConfig({...valid(),eventKind:"health_updated",healthMetric:metric});
  for (const patch of [{healthMetric:null},{healthMetric:"invented"},{sourceTaskId:"source",healthMetric:"heart_rate"}])
    assert.throws(()=>api.validateProactiveConfig({...valid(),eventKind:"health_updated",...patch}));
  assert.throws(()=>api.validateProactiveConfig({...valid(),healthMetric:"heart_rate"}));
});

test("event execution requires a live original paired host and retains provider-qualified model identity", () => {
  const peerId="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const host={hostId:peerId,platform:"macos",executorReady:true,acceptsBackgroundTasks:true,workspaceAvailable:true,
    inputSnapshotVersion:1,sourceContextVersion:1,workdir:"/work",providers:[{id:"provider-one",name:"One",models:["same-model"]},{id:"provider-two",name:"Two",models:["same-model"]}]};
  const original={...snapshot(),executionPeers:[{peerId,online:true,host}]};
  assert.deepEqual(api.eligibleProactivePeers(original).map(p=>p.peerId),[peerId]);
  assert.deepEqual(api.eligibleProactivePeers(original,true),[]);
  host.sourceContextVersion=host.sourceRoutingVersion=host.deviceChannelVersion=host.deviceActionsVersion=1;
  assert.equal(api.eligibleProactivePeers(original,true).length,0,"v1 cannot join read-only health branches");
  host.sourceRoutingVersion=2;
  assert.equal(api.eligibleProactivePeers(original,true).length,1);
  for(const patch of [{online:false},{peerId:"other-host"},{host:{...host,executorReady:false}},{host:{...host,inputSnapshotVersion:0}},{host:{...host,sourceContextVersion:0}},{host:{...host,workdir:""}}])
    assert.deepEqual(api.eligibleProactivePeers({...original,executionPeers:[{...original.executionPeers[0],...patch}]}),[]);
  assert.deepEqual(api.eligibleProactivePeers({...original,hostId:peerId}),[]);
  const remoteExecution={peerId,providerId:"provider-two",model:"same-model",workdir:"/work"};
  api.validateProactiveConfig({...valid(),remoteExecution});
  for(const patch of [{peerId:"MAC"},{providerId:""},{model:""},{workdir:""}])
    assert.throws(()=>api.validateProactiveConfig({...valid(),remoteExecution:{...remoteExecution,...patch}}),/invalidExecutor/);
  assert.equal(api.proactiveDeliveryStatus({state:"queued",remoteRequestId:"original-request",runState:null}),"proactive.state.delivering");
  assert.equal(api.proactiveDeliveryStatus({state:"queued",remoteRequestId:"original-request",runState:"waiting"}),"proactive.state.waiting");
});

function fixture(options = {}) {
  const hooks = createReactHookHarness(), calls = [], listeners = new Map();
  let captures = 0;
  const port = { async invoke(command, args) {
    calls.push({ command, args });
    if (command === "automation_proactive_snapshot") return options.read?.(calls.length) ?? snapshot();
    if (options.failure) throw new Error(options.failure);
    return options.write?.() ?? snapshot(args.input.revision + 1);
  } };
  const previous = globalThis.window;
  globalThis.window = { addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name) };
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@xgent/runtime": { invoke: () => { throw new Error("Uncaptured transport must not run"); }, invokeNative:port.invoke },
    "../runtimePlatform": {isNativeMobileRuntime:()=>options.mobile===true},
    "../tools/toolCommandPort": { captureToolCommandPort: async () => { captures++; return port; } },
  } });
  const { useProactiveRules } = loader.loadModule("src/lib/automation/useProactiveRules.ts");
  return { hooks, calls, listeners, render: () => hooks.render(useProactiveRules), get captures() { return captures; }, cleanup() { hooks.unmount(); globalThis.window = previous; } };
}

test("rule changes use the captured owner and revision; duplicate clicks are not duplicate writes", async () => {
  const pending = deferred(), f = fixture({ write: () => pending.promise });
  try {
    f.render(); await tick(); let ui = f.render(); assert.equal(ui.snapshot.hostId, "original-pc");
    const first = ui.apply({ op: "create", config: valid() }); await tick();
    assert.equal(await ui.apply({ op: "create", config: valid() }), false);
    assert.equal(f.calls.filter(c => c.command === "automation_proactive_apply").length, 1);
    assert.equal(f.calls.at(-1).args.input.revision, 0);
    pending.resolve(snapshot(1)); assert.equal(await first, true); assert.equal(f.render().snapshot.revision, 1);
    assert.equal(f.captures, 1);
  } finally { f.cleanup(); }
});

test("installed mobile rules stay on the original native device rather than the selected PC transport",async()=>{
  const f=fixture({mobile:true,read:()=>snapshot(0,"original-phone"),write:()=>snapshot(1,"original-phone")});
  try {
    f.render();await tick();const ui=f.render();
    assert.equal(ui.snapshot.hostId,"original-phone");assert.equal(f.captures,0);
    assert.equal(await ui.apply({op:"create",config:valid()}),true);
    assert.deepEqual(f.calls.map(call=>call.command),["automation_proactive_snapshot","automation_proactive_apply"]);
  }finally{f.cleanup();}
});

test("owner change invalidates in-flight replies and edits until an explicit fresh capture", async () => {
  const pending = deferred(), f = fixture({ read: count => count === 1 ? pending.promise : snapshot(9) });
  try {
    f.render(); await tick(); f.listeners.get("xgent:lan-pc-session-changed")();
    pending.resolve(snapshot(7, "previous-pc")); await tick();
    let ui = f.render(); assert.equal(ui.snapshot, null); assert.equal(ui.ownerChanged, true);
    assert.equal(await ui.apply({ op: "delete", id: "previous-rule" }), false);
    assert.equal(f.calls.some(c => c.command === "automation_proactive_apply"), false);
    assert.equal(await ui.refresh(), true); ui = f.render(); assert.equal(ui.snapshot.revision, 9); assert.equal(ui.ownerChanged, false); assert.equal(f.captures, 2);
  } finally { f.cleanup(); }
});

test("failed native mutation keeps the old state and reports the actual error", async () => {
  const f = fixture({ failure: "Rules changed on another client" });
  try {
    f.render(); await tick(); const ui = f.render();
    assert.equal(await ui.apply({ op: "delete", id: "rule" }), false);
    const next = f.render(); assert.equal(next.snapshot.revision, 0); assert.equal(next.error, "Rules changed on another client"); assert.equal(next.busy, false);
  } finally { f.cleanup(); }
});

test("effect replay starts a fresh read and an old request cannot overwrite its owner", async () => {
  const first = deferred(), second = deferred(), f = fixture({ read: count => count === 1 ? first.promise : second.promise });
  try {
    f.render(); await tick(); f.hooks.replayEffects(); await tick();
    second.resolve(snapshot(2)); await tick(); assert.equal(f.render().snapshot.revision, 2);
    first.resolve(snapshot(1)); await tick(); assert.equal(f.render().snapshot.revision, 2); assert.equal(f.render().busy, false);
  } finally { f.cleanup(); }
});

test("malformed creation cannot reach native persistence; late replies after unmount are discarded", async () => {
  const pending = deferred(), f = fixture({ write: () => pending.promise });
  try {
    f.render(); await tick(); let ui = f.render();
    assert.equal(await ui.apply({ op: "create", config: { ...valid(), cooldownMinutes: 0 } }), false);
    assert.equal(f.calls.filter(c => c.command === "automation_proactive_apply").length, 0);
    const writing = f.render().apply({ op: "set_enabled", id: "rule", enabled: false });
    f.hooks.unmount(); pending.resolve(snapshot(1)); assert.equal(await writing, false);
  } finally { f.cleanup(); }
});
