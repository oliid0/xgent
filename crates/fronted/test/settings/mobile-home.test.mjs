import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const homeId = "11111111-1111-4111-8111-111111111111";
const accessoryId = "22222222-2222-4222-8222-222222222222";
const status = { available: true, backend: "ios-native", homeAvailable: true, permissionAliases: { home: "device-home" } };
const inventory = () => ({ source: "homekit", observedAtMs: Date.now(), truncated: false, records: [
  { kind: "home", id: homeId, homeId, name: "Home" },
  { kind: "accessory", id: accessoryId, homeId, name: "Light", reachable: false },
] });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function fixture(options = {}) {
  const calls = [], hooks = createReactHookHarness();
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push({ command, args });
      if (command.endsWith("|status")) return options.status ?? status;
      if (command.endsWith("|check_permissions")) return { "device-home": options.permission ?? "granted" };
      if (command.endsWith("|request_permissions")) {
        options.onRequest?.(); return options.pendingPermission?.promise ?? { "device-home": options.requested ?? "granted" };
      }
      if (command.endsWith("|list_home_inventory")) {
        options.onRead?.(); if (options.failure) throw new Error(options.failure);
        return options.pending?.promise ?? options.data ?? inventory();
      }
      if (command === "automation_device_identity") return { hostId: homeId };
      if (command === "automation_mobile_connector_execute") {
        options.onExecute?.(args.input);
        return options.pendingNative?.promise ?? { input: args.input, destination: {kind:"home_power", id: args.input.request.characteristicId,sourceId:args.input.request.homeId,source:"Home"},
          state:options.writeState ?? "succeeded",result:{id:args.input.request.characteristicId,presented:false,detail:"Power confirmed"},error:null,startedAt:1,finishedAt:2 };
      }
      throw new Error(`Unexpected command ${command}`);
    } },
  } });
  return { calls, hooks, loader, api: loader.loadModule("src/lib/connectors/mobileHome.ts") };
}

const serviceId="33333333-3333-4333-8333-333333333333",characteristicId="44444444-4444-4444-8444-444444444444";
const powerRequest=()=>({homeId,accessoryId,serviceId,characteristicId,power:true});
const controllableInventory=()=>{
  const data=inventory();data.records[1].reachable=true;
  data.records[1].powerControls=[{id:characteristicId,serviceId,name:"Light"}];return data;
};

test("Home control binds a freshly observed writable target and preserves its actual native receipt",async()=>{
  const f=fixture({data:controllableInventory()});
  const result=await f.api.setAuthorizedMobileHomePower(powerRequest(),"same-home-intent");
  assert.equal(result.id,characteristicId);assert.equal(result.deviceHostId,homeId);
  const write=f.calls.find(call=>call.command==="automation_mobile_connector_execute");
  assert.equal(write.args.input.kind,"home_power");assert.deepEqual(write.args.input.request,powerRequest());
  assert.ok(f.calls.findIndex(call=>call.command.endsWith("|list_home_inventory"))<f.calls.indexOf(write));
  assert.ok(!f.calls.some(call=>/lan|cloud|submit|\|set_home_power/.test(call.command)));
});

test("unknown Home power effects and unobserved, unreachable or changed targets cannot report completion",async()=>{
  const f=fixture({data:controllableInventory(),writeState:"unknown"});
  await assert.rejects(f.api.setAuthorizedMobileHomePower(powerRequest(),"unknown-home-intent"),/will not be replayed/);
  for(const mutate of [data=>{data.records[1].reachable=false;},data=>{data.records[1].powerControls=[];},data=>{data.records[1].powerControls[0].serviceId=homeId;}]) {
    const data=controllableInventory();mutate(data);const blocked=fixture({data});
    await assert.rejects(blocked.api.setAuthorizedMobileHomePower(powerRequest(),"blocked-home-intent"),/not observed/);
    assert.ok(!blocked.calls.some(call=>call.command==="automation_mobile_connector_execute"));
  }
  for(const request of [{...powerRequest(),power:"on"},{...powerRequest(),homeId:"Home"}]) {
    const invalid=fixture();await assert.rejects(invalid.api.setAuthorizedMobileHomePower(request,"invalid"));assert.equal(invalid.calls.length,0);
  }
});

test("Home power scope rejects duplicate/cross-kind IDs and cancellation or policy revocation before the native claim",async()=>{
  for(const mutate of [data=>data.records[1].powerControls.push({...data.records[1].powerControls[0]}),data=>{data.records[0].powerControls=data.records[1].powerControls;},data=>{data.records[1].powerControls[0].id="Light";}]) {
    const data=controllableInventory();mutate(data);const f=fixture({data});await assert.rejects(f.api.readAuthorizedMobileHomeInventory());
  }
  for(const cancelled of [false,true]) {
    const controller=new AbortController();let allowed=true;
    const f=fixture({data:controllableInventory(),onRead(){if(cancelled)controller.abort();else allowed=false;}});
    await assert.rejects(f.api.setAuthorizedMobileHomePower(powerRequest(),"retired",controller.signal,()=>{if(!allowed)throw new Error("Denied");}),/Cancelled|Denied/);
    assert.ok(!f.calls.some(call=>call.command==="automation_mobile_connector_execute"));
  }
});

test("Home power hook owns one operation, blocks duplicate presses and reuses an unknown original intent",async()=>{
  const pending=deferred(),options={data:controllableInventory(),pendingNative:pending},f=fixture(options);
  const {useMobileHome}=f.loader.loadModule("src/lib/connectors/useMobileHome.ts");
  const render=enabled=>f.hooks.render(()=>useMobileHome(enabled??true));
  await render().refresh();const first=render().setPower(powerRequest()),duplicate=render().setPower(powerRequest());await tick();
  assert.equal(render().powerBusy,true);assert.equal(render().powerActionId,`home-power:${characteristicId}:on`);
  const write=f.calls.find(call=>call.command==="automation_mobile_connector_execute");assert.ok(write);
  const input=write.args.input;pending.resolve({input,destination:{kind:"home_power",id:characteristicId,sourceId:homeId,source:"Home"},state:"unknown",result:null,error:"SDK reply lost",startedAt:1,finishedAt:2});
  await Promise.all([first,duplicate]);assert.equal(f.calls.filter(call=>call.command==="automation_mobile_connector_execute").length,1);
  assert.match(render().error,/unknown/);options.pendingNative=undefined;options.writeState="unknown";
  await render().setPower(powerRequest());
  assert.equal(f.calls.at(-1).args.input.operationId,input.operationId);
  assert.equal(render().busy,false);assert.equal(render().powerBusy,false);
  f.hooks.unmount();
});

test("Home agent power controls use existing personal policy and cannot escape a calendar/reminder task branch",async()=>{
  for(const mode of ["allow","deny","ask","branch"]) {
    const f=fixture({data:controllableInventory()});
    const {createMobilePersonalAssistantTools}=f.loader.loadModule("src/lib/tools/mobilePersonalAssistantTools.ts");
    const bundle=createMobilePersonalAssistantTools({getToolPolicies:()=>({"personal:home":mode==="branch"?"allow":mode}),
      ...(mode==="branch"?{executeDurableWrite:()=>assert.fail("Home cannot acquire a calendar branch effect")}:{})});
    const result=await bundle.executeToolCall({type:"toolCall",id:"home-power-call",name:"MobilePersonalActions",arguments:{action:"set_home_power",home_id:homeId,accessory_id:accessoryId,service_id:serviceId,characteristic_id:characteristicId,power:true}});
    assert.equal(result.isError,mode!=="allow",mode);
    assert.equal(f.calls.some(call=>call.command==="automation_mobile_connector_execute"),mode==="allow",mode);
  }
});

test("Home inventory uses the actual phone plugin and exact observed home UUID", async () => {
  const f = fixture(), data = await f.api.readAuthorizedMobileHomeInventory({ limit: 3, homeId });
  assert.equal(data.records[1].reachable, false); assert.equal(data.source, "homekit");
  assert.deepEqual(f.calls.at(-1), { command: "plugin:mobile-assistant|list_home_inventory", args: { request: { limit: 3, homeId } } });
  assert.equal(f.calls.some(c => /lan|cloud|submit/.test(c.command)), false);
});

test("Home authorization uses the actual alias and never equates requested with granted", async () => {
  for (const requested of ["granted", "requested", "denied"]) {
    const f = fixture({ permission: "prompt", requested });
    const read = f.api.readAuthorizedMobileHomeInventory();
    if (requested === "granted") await read; else await assert.rejects(read, /not granted/);
    assert.deepEqual(f.calls.find(c => c.command.endsWith("|request_permissions")).args.request.permissions, ["device-home"]);
    assert.equal(f.calls.some(c => c.command.endsWith("|list_home_inventory")), requested === "granted");
  }
});

test("Home denied OS access, unsupported device and missing native adapter cannot read or prompt", async () => {
  for (const options of [
    { permission: "denied" }, { status: { ...status, backend: "android-native" } },
    { status: { ...status, backend: "desktop-unavailable" } }, { status: { ...status, homeAvailable: false } },
    { status: { ...status, permissionAliases: {} } },
  ]) {
    const f = fixture(options); await assert.rejects(f.api.readAuthorizedMobileHomeInventory());
    assert.ok(!f.calls.some(c => /\|(request_permissions|list_home_inventory)$/.test(c.command)));
  }
});

test("invalid Home request is rejected before authorization or native IPC", async () => {
  for (const request of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { limit: NaN }, { homeId: "Living room" }, { homeId: null }]) {
    const f = fixture(); await assert.rejects(f.api.readAuthorizedMobileHomeInventory(request)); assert.equal(f.calls.length, 0);
  }
});

test("late Home authorization or read is discarded on cancellation", async () => {
  for (const stage of ["permission", "read"]) {
    const pending = deferred(), controller = new AbortController();
    const f = fixture(stage === "permission" ? { permission: "prompt", pendingPermission: pending } : { pending });
    const read = f.api.readAuthorizedMobileHomeInventory({}, controller.signal);
    const rejection = assert.rejects(read, /Cancelled/);
    await tick(); controller.abort(); pending.resolve(stage === "permission" ? { "device-home": "granted" } : inventory());
    await rejection;
    if (stage === "permission") assert.ok(!f.calls.some(c => c.command.endsWith("|list_home_inventory")));
  }
});

test("Home native error is preserved while a confirmed empty authorized inventory is valid", async () => {
  const f = fixture({ failure: "HomeKit data load timed out" });
  await assert.rejects(f.api.readAuthorizedMobileHomeInventory(), /data load timed out/);
  const empty = fixture({ data: { ...inventory(), records: [] } });
  assert.deepEqual((await empty.api.readAuthorizedMobileHomeInventory()).records, []);
  await assert.rejects(empty.api.readAuthorizedMobileHomeInventory({ homeId }), /did not confirm/);
});

test("Home result validation rejects missing provenance, orphan identity, duplicates and fake reachability", async () => {
  for (const mutate of [
    d => { d.source = "remote"; }, d => { d.observedAtMs = 0; }, d => { d.truncated = undefined; },
    d => { d.records[1].reachable = "yes"; }, d => { d.records[1].homeId = accessoryId; },
    d => { d.records.push({ ...d.records[1] }); }, d => { d.records[0].id = accessoryId; },
    d => { d.records[1].roomId = "Kitchen"; }, d => { d.records[0].kind = "actuator"; },
  ]) {
    const data = inventory(); mutate(data); const f = fixture({ data });
    await assert.rejects(f.api.readAuthorizedMobileHomeInventory(), /invalid|duplicate|identity|confirm/);
  }
  const f = fixture(); await assert.rejects(f.api.listMobileHomeInventory(1), /invalid/);
});

test("Home capability catalog requires iOS availability independently of agent access policy", () => {
  const { mobileConnectorCatalog } = fixture().loader.loadModule("src/lib/connectors/mobileConnectorCatalog.ts");
  const entry = (s, permissions, policies) => mobileConnectorCatalog(s, permissions, policies).find(c => c.id === "home");
  assert.equal(entry(status, { home: "granted" }).state, "authorized");
  assert.equal(entry(status, { home: "granted" }, { "personal:home": "deny" }).state, "blocked");
  assert.equal(entry({ ...status, backend: "android-native" }, { home: "granted" }).state, "unavailable");
  assert.equal(entry({ ...status, homeAvailable: false }, { home: "granted" }).canRequest, false);
  assert.equal(entry(status, { home: "requested" }).state, "requested");
});

test("agent Home access respects DENY, default ASK and policy changes during OS authorization", async () => {
  for (const mode of ["allow", "deny", "ask", "broad-deny", "deny-during", "deny-after-read"]) {
    const policies = { "personal:home": mode === "ask" ? "ask" : mode === "deny" ? "deny" : "allow" };
    if (mode === "broad-deny") policies.MobilePersonalData = "deny";
    const f = fixture({ permission: mode === "deny-during" ? "prompt" : "granted", onRequest() { if (mode === "deny-during") policies["personal:home"] = "deny"; }, onRead() { if (mode === "deny-after-read") policies["personal:home"] = "deny"; } });
    const { createMobilePersonalAssistantTools } = f.loader.loadModule("src/lib/tools/mobilePersonalAssistantTools.ts");
    const bundle = createMobilePersonalAssistantTools({ getToolPolicies: () => policies });
    const result = await bundle.executeToolCall({ type: "toolCall", id: "home-read", name: "MobilePersonalData", arguments: { action: "list_home_inventory", home_id: homeId } });
    assert.equal(result.isError, mode !== "allow", mode);
    assert.equal(f.calls.some(c => c.command.endsWith("|list_home_inventory")), ["allow", "deny-after-read"].includes(mode), mode);
    if (mode === "deny-after-read") assert.ok(!result.content[0].text.includes(accessoryId), "revoked access must not release a late native result to the model");
    if (mode === "allow") assert.deepEqual(JSON.parse(result.content[0].text).inventory.records.map(r => r.id), [homeId, accessoryId]);
    if (["deny", "ask", "broad-deny"].includes(mode)) assert.equal(f.calls.length, 0);
  }
});

test("Home refresh has no passive reads, ignores duplicate presses and retires old page results", async () => {
  const pending = deferred(), f = fixture({ pending });
  const { useMobileHome } = f.loader.loadModule("src/lib/connectors/useMobileHome.ts");
  const render = (enabled = true) => f.hooks.render(() => useMobileHome(enabled));
  render(); assert.equal(f.calls.length, 0);
  const running = render().refresh(), duplicate = render().refresh(); await tick();
  assert.equal(render().busy, true); assert.equal(f.calls.filter(c => c.command.endsWith("|list_home_inventory")).length, 1);
  render(false); render(true); pending.resolve(inventory()); await Promise.all([running, duplicate]);
  assert.equal(render().data, null); assert.equal(render().busy, false);
  const count = f.calls.length; await render(false).refresh(); assert.equal(f.calls.length, count);
  f.hooks.unmount();
});

test("Home refresh clears stale data on failure and supports an explicit retry", async () => {
  const options = {}, f = fixture(options);
  const { useMobileHome } = f.loader.loadModule("src/lib/connectors/useMobileHome.ts");
  const render = () => f.hooks.render(() => useMobileHome(true));
  await render().refresh(); assert.ok(render().data);
  options.failure = "Home access revoked"; await render().refresh();
  assert.equal(render().data, null); assert.match(render().error, /revoked/); assert.equal(render().busy, false);
  options.failure = undefined; await render().refresh(); assert.ok(render().data); assert.equal(render().error, "");
  f.hooks.unmount();
});

test("Home inventory binds explicit permission lifecycle and bounded loading without starting control effects", () => {
  const source = path => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
  const home = source("crates/mobile-assistant/ios/Sources/HomeKitAccess.swift");
  assert.match(home, /HMHomeManagerDelegate/); assert.match(home, /homeManagerDidUpdateHomes/);
  assert.match(home, /guard self\.loaded/); assert.match(home, /authorizationStatus/);
  assert.match(home, /pending\.removeValue/); assert.match(home, /timeout\.cancel/); assert.match(home, /records\.count < args\.limit/);
  const inventorySource=home.slice(home.indexOf("func list("),home.indexOf("private func powerTarget("));
  assert.equal(/executeActionSet|writeValue|dispatch_semaphore/.test(inventorySource), false);
  const plugin = source("crates/mobile-assistant/ios/Sources/MobileAssistantPlugin.swift");
  assert.match(plugin, /homeAccess\.request\(invoke\).*self\.checkPermissions/);
  assert.match(plugin, /listHomeInventory.*homeAccess\.list/);
  for (const path of ["crates/mobile-assistant/src/lib.rs", "crates/mobile-assistant/build.rs", "crates/mobile-assistant/permissions/default.toml"])
    assert.match(source(path), /list[_-]home[_-]inventory/);
  assert.match(source("crates/fronted/src-tauri/ios.project.yml"), /com\.apple\.developer\.homekit: true/);
  assert.match(source("crates/fronted/src-tauri/Info.ios.plist"), /NSHomeKitUsageDescription/);
  assert.match(source("crates/mobile-assistant/ios/Package.swift"), /linkedFramework\("HomeKit"\)/);
  assert.match(source("crates/mobile-assistant/android/src/main/java/com/ohi/xgent/mobileassistant/MobileAssistantPlugin.kt"), /fun listHomeInventory[\s\S]*?invoke\.reject/);
});
