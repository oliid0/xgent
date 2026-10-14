import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const config = { name: "Inspect result", targetTaskId: "target", sourceTaskId: null, eventKind: "run_succeeded", cooldownMinutes: 5, maxAgeMinutes: 60, quietStart: null, quietEnd: null };
function fixture(native = false) {
  const hooks = createReactHookHarness(), calls = [], mocks = {};
  const rules = { snapshot: { revision: 0, hostId: "actual-pc", hostTime: "2026-10-10T10:00:00-07:00", rules: [], deliveries: [], targets: [{ id: "target", name: "Follow-up", type: "prompt", enabled: true }, { id: "source", name: "Source", type: "bash", enabled: true }] }, busy: false, error: null, ownerChanged: false, async refresh() { calls.push("refresh"); return true; }, async apply(op) { calls.push(op); return true; } };
  for (const [module, names] of Object.entries({ Banner: ["Banner"], Button: ["Button"], Layout: ["Section", "VStack"], Selector: ["Selector"], Switch: ["Switch"], Text: ["Heading", "Text"], TextInput: ["TextInput"] }))
    mocks[`@astryxdesign/core/${module}`] = Object.fromEntries(names.map(name => [name, name]));
  const loader = createTsModuleLoader({ mocks: { ...mocks, react: hooks.react,
    "react-dom": { flushSync: fn => fn() },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/automation/useProactiveRules": { useProactiveRules: () => rules },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => native },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => false },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/NativeSettingsContent": { NativeSettingsContent: "NativeSettingsContent" },
  } });
  const { ProactiveRulesContent } = loader.loadModule("src/pages/settings/ProactiveRulesSection.tsx");
  const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : [value, ...flatten(value.props?.children)];
  const render = () => hooks.render(() => ProactiveRulesContent({ rules, settings: { theme: "light" }, onBack: () => calls.push("back") }));
  return { rules, calls, render, elements: () => flatten(render()), node(label) { return this.elements().find(node => node.props?.label === label); } };
}

test("HTML form submits validated real config, refreshes receipts and prevents partial quiet hours", async () => {
  const f = fixture();
  assert.equal(f.node("proactive.create").props.isDisabled, true);
  f.node("proactive.name").props.onChange("Inspect result");
  f.node("proactive.target").props.onChange("target");
  f.node("proactive.quietStart").props.onChange("22:00");
  f.node("proactive.create").props.onClick(); await Promise.resolve();
  assert.equal(f.calls.length, 0); assert.ok(f.elements().some(n => n.type === "Banner" && n.props.title === "proactive.invalidTime"));
  f.node("proactive.quietEnd").props.onChange("07:00");
  f.node("proactive.create").props.onClick(); await Promise.resolve();
  assert.deepEqual(f.calls[0], { op: "create", config: { ...config, quietStart: 1320, quietEnd: 420 } });
  f.node("proactive.refresh").props.onClick(); assert.equal(f.calls.at(-1), "refresh");
  f.rules.busy = true; assert.equal(f.node("proactive.target").props.isDisabled, true);
  assert.equal(f.node("proactive.refresh").props.isDisabled, true);
});

test("actual rule toggles persist, deletion requires confirmation and accepted queue is not labelled completed", async () => {
  const f = fixture();
  f.rules.snapshot.rules = [{ id: "rule", config, enabled: true, lastQueuedAt: null, lastError: null }];
  f.rules.snapshot.deliveries = [{ ruleId: "rule", eventSequence: 1, state: "queued", runState: "pending", runSuccess: false, reason: "accepted", sourceTaskId: "source", sourceExecutionId: "source-execution", executionId: "follow-execution", updatedAt: 100 }];
  f.node("proactive.enabled").props.onChange(false);
  assert.deepEqual(f.calls.at(-1), { op: "set_enabled", id: "rule", enabled: false });
  const text = JSON.stringify(f.render()); assert.match(text, /proactive.state.queued/); assert.doesNotMatch(text, /proactive.state.done/);
  f.node("proactive.delete").props.onClick(); assert.equal(f.calls.some(c => c?.op === "delete"), false);
  const deletes = f.elements().filter(n => n.type === "Button" && n.props.label === "proactive.delete");
  deletes.at(-1).props.onClick(); await Promise.resolve();
  assert.deepEqual(f.calls.at(-1), { op: "delete", id: "rule" });
});

test("native settings uses the same validated create action, pause, delete confirmation and loading guards", async () => {
  const f = fixture(true);
  const fire = async (id, value = null) => { const handler = f.render().props.handlers.get(id); assert.equal(handler.enabled, true); assert.equal(handler.accepts(value), true); await handler.run(value); };
  await fire("name", "Inspect result"); await fire("target", "target");
  await fire("save"); assert.deepEqual(f.calls.at(-1), { op: "create", config });
  f.rules.snapshot.rules = [{ id: "rule", config, enabled: true, lastQueuedAt: null, lastError: null }];
  await fire("rule:enabled", false); assert.deepEqual(f.calls.at(-1), { op: "set_enabled", id: "rule", enabled: false });
  await fire("rule:delete"); assert.equal(f.calls.some(c => c?.op === "delete"), false);
  await fire("delete-confirm"); assert.deepEqual(f.calls.at(-1), { op: "delete", id: "rule" });
  f.rules.busy = true; assert.equal(f.render().props.handlers.get("refresh").enabled, false);
  f.rules.busy = false; f.rules.ownerChanged = true;
  assert.equal(f.render().props.handlers.get("save").enabled, false);
  assert.equal(f.render().props.handlers.get("rule:enabled").enabled, false);
  await fire("back"); assert.equal(f.calls.at(-1), "back");
});

test("changing the displayed owner clears old task selections and an outstanding delete confirmation", () => {
  const f = fixture();
  f.rules.snapshot.rules = [{ id: "rule", config, enabled: true, lastQueuedAt: null, lastError: null }];
  f.node("proactive.name").props.onChange("Previous owner draft");
  f.node("proactive.target").props.onChange("target");
  f.node("proactive.delete").props.onClick();
  assert.equal(f.elements().filter(n => n.type === "Button" && n.props.label === "proactive.delete").length, 2);
  f.rules.snapshot = { ...f.rules.snapshot, hostId: "different-pc" };
  assert.equal(f.node("proactive.name").props.value, "");
  assert.equal(f.node("proactive.target").props.value, "");
  assert.equal(f.elements().filter(n => n.type === "Button" && n.props.label === "proactive.delete").length, 1);
  assert.equal(f.node("proactive.create").props.isDisabled, true);
});

test("both renderers create the same Home scope from actual sources, reject removed homes and reset on owner changes", async () => {
  const homeId = "11111111-1111-4111-8111-111111111111";
  for (const native of [false, true]) {
    const f = fixture(native);
    const change = async (id, label, value) => {
      if (native) { const handler = f.render().props.handlers.get(id); assert.equal(handler.accepts(value), true); await handler.run(value); }
      else f.node(label).props.onChange(value);
    };
    if (!native) assert.equal(f.node("proactive.event").props.options.some(option => option.value === "home_power_changed"), false);
    f.rules.snapshot.homeEventHomes = [{ id: homeId, name: "Actual authorized Home" }];
    await change("name", "proactive.name", "Home follow-up"); await change("target", "proactive.target", "target");
    await change("source", "proactive.source", "source"); await change("kind", "proactive.event", "home_power_changed");
    const canSave = () => native ? f.render().props.handlers.get("save").enabled : !f.node("proactive.create").props.isDisabled;
    assert.equal(canSave(), false);
    if (native) assert.equal(f.render().props.handlers.has("source"), false); else assert.equal(f.node("proactive.source"), undefined);
    await change("home-source", "proactive.home", homeId); assert.equal(canSave(), true);
    if (native) await f.render().props.handlers.get("save").run(null);
    else { f.node("proactive.create").props.onClick(); await Promise.resolve(); }
    assert.deepEqual(f.calls.at(-1), { op: "create", config: { ...config, name: "Home follow-up", eventKind: "home_power_changed", homeId, sourceTaskId: null } });
    f.rules.snapshot.homeEventHomes = []; assert.equal(canSave(), false);
    f.rules.snapshot.homeEventError = "Selected Home is no longer accessible";
    assert.match(JSON.stringify(f.render()), /Selected Home is no longer accessible/);
    f.rules.snapshot = { ...f.rules.snapshot, hostId: "another-installation" };
    if (native) assert.equal(f.render().props.handlers.has("home-source"), false); else assert.equal(f.node("proactive.home"), undefined);
  }
});

test("health rules use actual supported metrics and submit the same source-free scope on both UI paths", async () => {
  for (const native of [false, true]) {
    const f = fixture(native);
    const fire = async (id, value) => { const handler = f.render().props.handlers.get(id); assert.equal(handler.accepts(value), true); await handler.run(value); };
    if (!native) assert.equal(f.node("proactive.event").props.options.some(o=>o.value==="health_updated"),false);
    f.rules.snapshot.healthEventMetrics = ["heart_rate","weight"];
    if (native) {
      await fire("name","Fitness check"); await fire("target","target"); await fire("source","source");
      await fire("kind","health_updated");
      assert.equal(f.render().props.handlers.has("source"),false);
      await fire("health-metric","weight"); await fire("save",null);
    } else {
      f.node("proactive.name").props.onChange("Fitness check"); f.node("proactive.target").props.onChange("target");
      f.node("proactive.source").props.onChange("source"); f.node("proactive.event").props.onChange("health_updated");
      assert.equal(f.node("proactive.source"),undefined);
      assert.deepEqual(f.node("proactive.healthMetric").props.options.map(o=>o.value),["heart_rate","weight"]);
      f.node("proactive.healthMetric").props.onChange("weight"); f.node("proactive.create").props.onClick(); await Promise.resolve();
    }
    assert.deepEqual(f.calls.at(-1),{op:"create",config:{...config,name:"Fitness check",eventKind:"health_updated",healthMetric:"weight",sourceTaskId:null}});
    f.rules.snapshot.healthEventError="Background delivery unavailable";
    assert.match(JSON.stringify(f.render()),/Background delivery unavailable/);
    f.rules.snapshot={...f.rules.snapshot,hostId:"other-host",healthEventMetrics:[]};
    if(native) assert.equal(f.render().props.handlers.has("health-metric"),false);
    else assert.equal(f.node("proactive.healthMetric"),undefined);
  }
});

test("both forms pin an explicitly chosen PC and provider/model, block stale catalogs and show actual delivery failures",async()=>{
  const peerId="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  for(const native of [false,true]) {
    const f=fixture(native);
    f.rules.snapshot.executionPeers=[{peerId,online:true,host:{hostId:peerId,platform:"macos",executorReady:true,
      acceptsBackgroundTasks:true,workspaceAvailable:true,inputSnapshotVersion:1,sourceContextVersion:1,workdir:"/real-pc-workspace",
      providers:[{id:"provider-one",name:"One",models:["same-model"]},{id:"provider-two",name:"Two",models:["same-model"]}]}}];
    const change=async(id,label,value)=>{
      if(native){const handler=f.render().props.handlers.get(id);assert.equal(handler.enabled,true);assert.equal(handler.accepts(value),true);await handler.run(value);}
      else f.node(label).props.onChange(value);
    };
    await change("name","proactive.name","Actual follow-up");await change("target","proactive.target","target");
    await change("execution-peer","proactive.executor",peerId);
    assert.equal(native?f.render().props.handlers.get("save").enabled:!f.node("proactive.create").props.isDisabled,false);
    await change("execution-provider","proactive.provider","provider-two");
    await change("execution-model","proactive.model","same-model");
    const order=native?f.render().props.document.nodes.find(node=>node.id==="create").children.filter(node=>node.kind==="Selector").map(node=>node.label):f.elements().filter(node=>node.type==="Selector").map(node=>node.props.label);
    assert.deepEqual(order.slice(0,4),["proactive.target","proactive.executor","proactive.provider","proactive.model"],"both renderers expose the same field hierarchy");
    if(native) await f.render().props.handlers.get("save").run(null);
    else {f.node("proactive.create").props.onClick();await Promise.resolve();}
    assert.deepEqual(f.calls.at(-1),{op:"create",config:{...config,name:"Actual follow-up",remoteExecution:{peerId,providerId:"provider-two",model:"same-model",workdir:"/real-pc-workspace"}}});
    f.rules.busy=true;
    assert.equal(native?f.render().props.handlers.get("execution-peer").enabled:!f.node("proactive.executor").props.isDisabled,false);
    f.rules.busy=false;f.rules.snapshot.executionPeers[0].online=false;
    assert.equal(native?f.render().props.handlers.get("save").enabled:!f.node("proactive.create").props.isDisabled,false);
    f.rules.snapshot.deliveries=[{ruleId:"rule",eventSequence:1,state:"queued",remoteRequestId:"saved-request",remoteHostId:peerId,
      runState:null,runSuccess:null,reason:"delivery_pending",sourceTaskId:"source",sourceExecutionId:"actual-event",executionId:null,
      deliveryError:"Original PC unavailable",updatedAt:100}];
    const result=JSON.stringify(f.render());assert.match(result,/proactive.state.delivering/);assert.match(result,/Original PC unavailable/);assert.doesNotMatch(result,/proactive.state.done/);
    f.rules.snapshot={...f.rules.snapshot,hostId:"another-owner"};
    assert.equal(native?f.render().props.document.nodes.find(n=>n.id==="create").children.find(n=>n.id==="execution-peer").value:f.node("proactive.executor").props.value,"");
  }
});

test("both existing selectors submit explicit background-read consent and clear it when the metric, model or target changes", async () => {
  const peerId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  for (const native of [false, true]) {
    const f = fixture(native);
    f.rules.snapshot.healthEventMetrics = ["heart_rate", "weight"];
    f.rules.snapshot.executionPeers = [{ peerId, online: true, host: { hostId: peerId, platform: "macos", executorReady: true,
      acceptsBackgroundTasks: true, workspaceAvailable: true, inputSnapshotVersion: 1, sourceContextVersion: 1,
      sourceRoutingVersion: 2, deviceChannelVersion: 1, deviceActionsVersion: 1, workdir: "/real",
      providers: [{ id: "actual", name: "Actual", models: ["actual"] }] } }];
    const change = async (id, label, value) => {
      if (native) { const handler = f.render().props.handlers.get(id); assert.equal(handler.enabled, true); await handler.run(value); }
      else f.node(label).props.onChange(value);
    };
    const value = () => native ? f.render().props.document.nodes.find(node => node.id === "create").children.find(node => node.id === "health-reads")?.value
      : f.node("proactive.healthReads")?.props.value;
    assert.equal(value(), undefined);
    await change("name", "proactive.name", "Actual health check"); await change("target", "proactive.target", "target");
    await change("execution-peer", "proactive.executor", peerId); await change("execution-provider", "proactive.provider", "actual");
    await change("execution-model", "proactive.model", "actual"); await change("kind", "proactive.event", "health_updated");
    assert.equal(value(), "manual");
    const submit = async () => { if (native) await f.render().props.handlers.get("save").run(null); else { f.node("proactive.create").props.onClick(); await Promise.resolve(); } };
    await submit(); assert.equal(f.calls.at(-1).config.backgroundHealthReads, undefined);
    await change("name", "proactive.name", "Actual health check"); await change("health-reads", "proactive.healthReads", "background");
    assert.equal(value(), "background"); await submit(); assert.equal(f.calls.at(-1).config.backgroundHealthReads, true);
    const order = native ? f.render().props.document.nodes.find(node => node.id === "create").children.filter(node => node.kind === "Selector").map(node => node.label)
      : f.elements().filter(node => node.type === "Selector").map(node => node.props.label);
    assert.deepEqual(order.slice(4, 7), ["proactive.healthMetric", "proactive.healthReads", "proactive.event"]);
    await change("health-metric", "proactive.healthMetric", "weight"); assert.equal(value(), "manual");
    await change("health-reads", "proactive.healthReads", "background"); await change("execution-model", "proactive.model", "actual"); assert.equal(value(), "manual");
    await change("health-reads", "proactive.healthReads", "background"); await change("execution-peer", "proactive.executor", peerId); assert.equal(value(), "manual");
    f.rules.busy = true;
    assert.equal(native ? f.render().props.handlers.get("health-reads").enabled : !f.node("proactive.healthReads").props.isDisabled, false);
    f.rules.busy = false; f.rules.snapshot = { ...f.rules.snapshot, hostId: "other-installation" }; assert.equal(value(), undefined);
  }
});
