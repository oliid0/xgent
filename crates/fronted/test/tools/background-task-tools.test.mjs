import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" };
const goalBinding={goalId:"launch",storeId:"original-store",revision:4};

function setup(overrides = {}, toolOptions = {}) {
  const calls = [];
  const nativeCalls = [];
  const ownershipCalls = [];
  const backend = new Proxy({}, { get: (_, method) => async (...args) => {
    if (method === "resolveBackgroundPeer") {
      ownershipCalls.push(args);
      return overrides[method] ? overrides[method](...args) : null;
    }
    calls.push({ method, args });
    if (["getBackgroundSubmissionState", "getLocalWorkerHostInfo"].includes(method) && !overrides[method]) return null;
    return overrides[method] ? overrides[method](...args) : { requestId: args[0]?.requestId, run: { state: "pending" } };
  } });
  const loader = createTsModuleLoader({ mocks: {
    "../automation/backend": { backend },
    "@tauri-apps/api/core": { async invoke(command, args) { nativeCalls.push({ command, args }); return overrides.nativeInvoke ? overrides.nativeInvoke(command, args) : { path: args.path }; } },
    "@xgent/runtime": { isTauriRuntime: () => true, getLanPcCommandHostConfig: () => ({ enabled: true, localWorkdir: "/phone/project" }) },
  } });
  const module = loader.loadModule("src/lib/tools/backgroundTaskTools.ts");
  const tools = module.createBackgroundTaskTools({ workdir: "/host/project", currentChatModel: { customProviderId: "host-provider", model: "host-model" }, ...(toolOptions.backgroundContext ? { backgroundLease: lease } : {}), ...toolOptions });
  const run = (args, id = "call-1", signal) => tools.executeToolCall({ id, name: "BackgroundTask", arguments: args }, signal);
  return { run, calls, nativeCalls, ownershipCalls, module, tools };
}

test("background submission carries an exact optional goal binding and requires actual acceptance evidence",async()=>{
  for(const peer of [undefined,"worker"]){
    const f=setup({getBackgroundHostInfo:()=>({goalAcceptanceVersion:1}),probeWorkerPeer:()=>hostInfo("worker",{goalAcceptanceVersion:1}),submitBackgroundTask:input=>({requestId:input.requestId,goalBinding:input.goalBinding,run:{state:"pending"}})});
    const args={action:"submit",name:"Product",prompt:"Produce actual files",goal_binding:goalBinding,...(peer?{peer_id:peer}:{})};
    const result=await f.run(args);assert.equal(result.isError,false);
    const submitted=f.calls.find(call=>call.method==="submitBackgroundTask");assert.deepEqual(submitted.args[0].goalBinding,goalBinding);assert.equal(submitted.args[1],peer);
    const original=submitted.args[0].requestId;await f.run(args);assert.deepEqual(f.calls.filter(call=>call.method==="submitBackgroundTask").map(call=>call.args[0].requestId),[original,original]);
  }
});

test("invalid or unsupported goal association accepts no task; legacy unassociated submissions stay usable",async()=>{
  for(const invalid of [null,[],{}, {...goalBinding,revision:-1},{...goalBinding,revision:Number.MAX_SAFE_INTEGER+1},{...goalBinding,goalId:"../goal"},{...goalBinding,storeId:""},{...goalBinding,extra:"invented"}]){
    const f=setup();assert.equal((await f.run({action:"submit",name:"Report",prompt:"Create report",goal_binding:invalid})).isError,true);assert.equal(f.calls.length,0);assert.equal(f.ownershipCalls.length,0);
  }
  for(const peer of [undefined,"worker"]){const f=setup({getBackgroundHostInfo:()=>({}),probeWorkerPeer:()=>hostInfo("worker")});assert.equal((await f.run({action:"submit",name:"Report",prompt:"Create report",goal_binding:goalBinding,...(peer?{peer_id:peer}:{})})).isError,true);assert.ok(!f.calls.some(call=>call.method==="submitBackgroundTask"));}
  const legacy=setup();assert.equal((await legacy.run({action:"submit",name:"Report",prompt:"Create report"})).isError,false);assert.ok(!Object.hasOwn(legacy.calls.find(call=>call.method==="submitBackgroundTask").args[0],"goalBinding"));
});

test("missing or mismatched goal receipt remains recoverable on its original request and never reports association",async()=>{
  for(const wrong of [undefined,{...goalBinding,storeId:"other"},{...goalBinding,revision:5}]){
    const f=setup({getBackgroundHostInfo:()=>({goalAcceptanceVersion:1}),submitBackgroundTask:input=>({requestId:input.requestId,goalBinding:wrong,run:{state:"pending"}})});
    const result=await f.run({action:"submit",name:"Product",prompt:"Create files",goal_binding:goalBinding});assert.equal(result.isError,true);assert.match(result.details.result.error,/unconfirmed/);assert.equal(result.details.result.requestId,f.calls.find(call=>call.method==="submitBackgroundTask").args[0].requestId);assert.equal(f.calls.filter(call=>call.method==="submitBackgroundTask").length,1);
  }
});

test("delegated child does not inherit the parent goal binding on another execution host",async()=>{
  const f=setup({probeWorkerPeer:()=>hostInfo("worker")},{backgroundContext:{rootRequestId:"root",requestId:"parent",hostIds:["issuer"],goalBinding}});
  assert.equal((await f.run({action:"submit",peer_id:"worker",name:"Website",prompt:"Build the actual site"})).isError,false);
  assert.ok(!Object.hasOwn(f.calls.find(call=>call.method==="submitBackgroundTask").args[0],"goalBinding"));
});

test("PC children receive only their accepted coverage contract while origin time and history stay frozen",async()=>{
  const source={version:2,requestScope:"original/turn",systemPrompt:"Original memory",originalRequest:"Report, slides, tomorrow calendar and nightly exercise",
    requestClock:{timestampMs:Date.parse("2026-10-14T06:30:00Z"),timeZone:"America/Los_Angeles"},messages:[{role:"user",content:"Original document references"}],
    routing:{version:1,initiatingHostId:"11111111-1111-4111-8111-111111111111",branches:[{id:"calendar",requirement:"Original phone calendar",dependsOn:[],locality:"initiating-device"}]}};
  const before=JSON.stringify(source);
  const f=setup({probeWorkerPeer:()=>hostInfo("worker",{sourceContextVersion:2})},{backgroundContext:{rootRequestId:"root",requestId:"parent",hostIds:["issuer"]},getSourceContext:()=>source});
  const args={action:"submit",peer_id:"worker",name:"Slides",prompt:"Create actual slides from the accepted document"};
  assert.equal((await f.run(args)).isError,false);
  const input=f.calls.find(call=>call.method==="submitBackgroundTask").args[0];
  assert.equal(input.sourceContext.originalRequest,args.prompt);assert.equal(input.sourceContext.routing,undefined);
  assert.equal(input.sourceContext.requestScope,`delegated-task/${input.requestId}`);assert.deepEqual(input.sourceContext.requestClock,source.requestClock);
  source.messages[0].content="Changed after admission";
  assert.equal(input.sourceContext.messages[0].content,"Original document references");
  const root=setup({getBackgroundHostInfo:()=>({sourceContextVersion:2})},{getSourceContext:()=>JSON.parse(before)});
  await root.run({action:"submit",name:"Entire request",prompt:"Carry out the whole request"});
  assert.deepEqual(root.calls.find(call=>call.method==="submitBackgroundTask").args[0].sourceContext,JSON.parse(before));
});

test("delegation passes the captured original call to native admission and marks missing acknowledgement uncertain", async () => {
  const context = { requestId: "parent", rootRequestId: "root", hostIds: ["issuer"] };
  const host = hostInfo("worker");
  const f = setup({ probeWorkerPeer: () => host, submitBackgroundTask: () => { throw new Error("ACK lost"); } }, { backgroundContext: context });
  const result = await f.run({ action: "submit", name: "Slides", prompt: "Create real slides", peer_id: "worker" }, "original-submit-call");
  assert.equal(result.isError, true); assert.equal(result.details.outcomeUncertain, true);
  const call = f.calls.find(call => call.method === "submitBackgroundTask");
  assert.deepEqual(call.args[0].delegation, { rootRequestId: "root", parentRequestId: "parent", ancestorHostIds: ["issuer"] });
  assert.deepEqual(call.args[2], lease); assert.equal(call.args[5], "original-submit-call");
});

test("scheduled device children carry only the explicitly allocated parent slots and captured lease", async () => {
  const context = { requestId: "parent", rootRequestId: "root", hostIds: ["issuer"] };
  const allocation = { max_model_requests: 12, max_tool_calls: 24 };
  const f = setup({ probeWorkerPeer: () => hostInfo("worker", { budgetDelegationVersion: 1, intelligentSchedulingVersion: 1 }) }, { backgroundContext: context, schedulingEnabled: true });
  const args = { action: "submit", peer_id: "worker", name: "Slides", prompt: "Create slides", delegation_budget: allocation };
  assert.equal((await f.run(args, "child-budget")).isError, false);
  const submitted = f.calls.find(c => c.method === "submitBackgroundTask");
  assert.deepEqual(submitted.args[0].delegation, { rootRequestId: "root", parentRequestId: "parent", ancestorHostIds: ["issuer"], budget: { version: 1, maxModelRequests: 12, maxToolCalls: 24 } });
  assert.equal(submitted.args[0].intelligentSchedulingEnabled, true);
  assert.deepEqual(submitted.args[2], lease); assert.equal(submitted.args[5], "child-budget");
  assert.equal((await f.run(args, "child-budget")).isError, false);
  assert.deepEqual(f.calls.filter(c => c.method === "submitBackgroundTask")[1], submitted);
  assert.deepEqual(allocation, { max_model_requests: 12, max_tool_calls: 24 });
});

test("scheduled PC delegates inherit the trusted deadline and exclude old workers before any send",async()=>{
  const deadlineAt=Date.now()+60_000;
  const args={action:"submit",peer_id:"worker",name:"Slides",prompt:"Create slides",delegation_budget:{max_model_requests:12,max_tool_calls:24}};
  const options={backgroundContext:{requestId:"parent",rootRequestId:"root",hostIds:["issuer"]},schedulingEnabled:true,getExecutionDeadline:()=>deadlineAt};
  for(const version of [undefined,0,2]){
    const f=setup({probeWorkerPeer:()=>hostInfo("worker",{budgetDelegationVersion:1,intelligentSchedulingVersion:1,budgetDeadlineVersion:version})},options);
    const result=await f.run(args);assert.equal(result.isError,true);
    assert.ok(!f.calls.some(call=>call.method==="submitBackgroundTask"));
  }
  const f=setup({probeWorkerPeer:()=>hostInfo("worker",{budgetDelegationVersion:1,intelligentSchedulingVersion:1,budgetDeadlineVersion:1})},options);
  assert.equal((await f.run(args)).isError,false);
  assert.equal(f.calls.find(call=>call.method==="submitBackgroundTask").args[0].delegation.budget.deadlineAt,deadlineAt);
  const expired=setup({}, {...options,getExecutionDeadline:()=>Date.now()-1});
  assert.equal((await expired.run(args)).isError,true);assert.ok(!expired.calls.some(call=>call.method==="submitBackgroundTask"));
});

test("missing, malformed or misplaced delegated budgets reach no child RPC", async () => {
  for (const allocation of [undefined, null, [], {}, { max_model_requests: 0, max_tool_calls: 1 }, { max_model_requests: 129, max_tool_calls: 1 }, { max_model_requests: 1, max_tool_calls: 257 }, { max_model_requests: 1.5, max_tool_calls: 2 }, { max_model_requests: 1, max_tool_calls: 2, extra: true }]) {
    const f = setup({}, { backgroundContext: { requestId: "parent", rootRequestId: "root", hostIds: ["issuer"] }, schedulingEnabled: true });
    const result = await f.run({ action: "submit", peer_id: "worker", name: "Slides", prompt: "Create slides", delegation_budget: allocation });
    assert.equal(result.isError, true); assert.match(result.details.result.error, /budget allocation/);
    assert.equal(f.calls.length, 0); assert.equal(result.details.outcomeUncertain, undefined);
  }
  for (const options of [{}, { schedulingEnabled: true }, { backgroundContext: { requestId: "parent", rootRequestId: "root", hostIds: ["issuer"] }, schedulingEnabled: false }]) {
    const f = setup({}, options);
    assert.equal((await f.run({ action: "submit", delegation_budget: { max_model_requests: 1, max_tool_calls: 2 } })).isError, true);
    assert.equal(f.calls.length, 0);
  }
});

test("scheduled handoffs reject an old or changed receiver before sending and route to budget-capable PCs", async () => {
  const options = { backgroundContext: { requestId: "parent", rootRequestId: "root", hostIds: ["issuer"] }, schedulingEnabled: true };
  const args = { action: "submit", name: "Slides", prompt: "Create slides", delegation_budget: { max_model_requests: 2, max_tool_calls: 4 } };
  for (const capabilities of [{}, { budgetDelegationVersion: 1 }, { budgetDelegationVersion: 2, intelligentSchedulingVersion: 1 }]) {
    const f = setup({ probeWorkerPeer: () => hostInfo("worker", capabilities) }, options);
    const result = await f.run({ ...args, peer_id: "worker" });
    assert.equal(result.isError, true); assert.equal(result.details.outcomeUncertain, undefined);
    assert.ok(!f.calls.some(c => c.method === "submitBackgroundTask"));
  }
  const supported = observedHost("supported", { budgetDelegationVersion: 1, intelligentSchedulingVersion: 1 });
  const f = setup({ listWorkerPeers: () => catalogOf([observedHost("legacy"), supported]), probeWorkerPeer: () => supported }, options);
  assert.equal((await f.run({ ...args, requirements: { capabilities: ["xcode"] } })).isError, false);
  assert.equal(f.calls.find(c => c.method === "submitBackgroundTask").args[1], "supported");
  const changed = setup({ listWorkerPeers: () => catalogOf([supported]), probeWorkerPeer: () => ({ ...supported, budgetDelegationVersion: 0 }) }, options);
  assert.equal((await changed.run({ ...args, requirements: { capabilities: ["xcode"] } })).isError, true);
  assert.ok(!changed.calls.some(c => c.method === "submitBackgroundTask"));
});

test("child observations use original parent and peer, and chunks carry the observed snapshot hash", async () => {
  const snapshotHash = "a".repeat(64), actual = { child: { callId: "accepted-call" }, available: true, snapshot: { text: "actual", snapshotHash, nextOffset: 8192 } };
  const f = setup({ readBackgroundChildren: () => actual });
  const args = { action: "children", request_id: "parent", peer_id: "original-worker", child_call_id: "accepted-call", offset: 8192, snapshot_hash: snapshotHash };
  const result = await f.run(args); assert.equal(result.isError, false); assert.deepEqual(result.details.result, { peerId: "original-worker", result: actual });
  assert.deepEqual(f.calls[0], { method: "readBackgroundChildren", args: ["parent", "original-worker", "accepted-call", 8192, snapshotHash] });
  assert.equal(f.module.isBackgroundTaskReadOnly({ name: "BackgroundTask", arguments: args }), true);
});

test("legacy child executors are rejected before sending and do not claim an uncertain external effect", async () => {
  const f = setup({ probeWorkerPeer: () => hostInfo("worker", { childTasksVersion: undefined }) }, { backgroundContext: { requestId: "parent", rootRequestId: "root", hostIds: ["issuer"] } });
  const result = await f.run({ action: "submit", peer_id: "worker", name: "Slides", prompt: "Create real slides" });
  assert.equal(result.isError, true); assert.match(result.details.result.error, /persistent child joins/);
  assert.equal(result.details.outcomeUncertain, undefined);
  assert.equal(f.calls.some(call => call.method === "submitBackgroundTask"), false);
});

test("child snapshot reads reject missing parent, malformed identity/hash and unbound later chunks before transport", async () => {
  for (const extra of [{ request_id: "" }, { child_call_id: "" }, { offset: -1 }, { offset: 1.5 }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { offset: 8192 }, { child_call_id: "real", offset: 8192 }, { snapshot_hash: "invented" }]) {
    const f = setup(); const result = await f.run({ action: "children", request_id: "parent", ...extra });
    assert.equal(result.isError, true); assert.equal(f.calls.length, 0);
  }
});

test("submission retries keep a stable UUID and cannot override the runtime model/workspace", async () => {
  const { run, calls } = setup();
  const args = { action: "submit", name: "report", prompt: "create files", providerId: "invented", model: "invented", workdir: "/wrong" };
  await run(args);
  await run(args);
  assert.deepEqual(calls[0], calls[1]);
  const input = calls[0].args[0];
  assert.match(input.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(input.workdir, "/host/project");
  assert.equal(input.providerId, "host-provider");
  assert.equal(input.model, "host-model");
});

test("root submission carries its actual chat scope to the durable intake without inventing context", async () => {
  const f = setup({}, { requestScope: "actual-conversation-and-turn" });
  await f.run({ action: "submit", name: "report", prompt: "Create the actual report" });
  assert.deepEqual(f.calls.find(c => c.method === "submitBackgroundTask").args.slice(1), [undefined, undefined, { requestScope: "actual-conversation-and-turn" }, false]);
});

test("waiting responses retain original request, occurrence, peer and one idempotent resume ID", async () => {
  const f = setup({}, { requestScope: "phone-conversation" });
  const args = { action: "resume", request_id: "accepted-request", wait_id: "actual-occurrence", peer_id: "accepted-peer", response: "Tomorrow at 10:00" };
  await f.run(args, "resume-call"); await f.run(args, "resume-call");
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.calls[0].method, "resumeBackgroundTask");
  assert.deepEqual(f.calls[0].args, [{ requestId: "accepted-request", waitId: "actual-occurrence", resumeId: f.module.backgroundRequestId("resume-call", "phone-conversation"), response: "Tomorrow at 10:00" }, "accepted-peer"]);
  assert.equal(f.module.isBackgroundTaskReadOnly({ name: "BackgroundTask", arguments: args }), false);
});

test("missing waiting occurrence or actual input cannot resume or accept a new task", async () => {
  for (const args of [{ action: "resume", response: "10:00" }, { action: "resume", request_id: "task", response: "10:00" }, { action: "resume", request_id: "task", wait_id: "wait", response: " " }]) {
    const f = setup(); assert.equal((await f.run(args)).isError, true); assert.equal(f.calls.length, 0);
  }
});

test("uncertain submit returns its request ID for recovery, not a new execution", async () => {
  const { run, module } = setup({ submitBackgroundTask() { throw new Error("ack lost"); } });
  const result = await run({ action: "submit", name: "report", prompt: "do work" });
  assert.equal(result.isError, true);
  assert.equal(result.details.result.requestId, module.backgroundRequestId("call-1"));
  assert.match(result.details.result.instruction, /query this requestId/);
});

test("cancellation/query require an explicit receipt, and aborted submit accepts no work", async () => {
  const { run, calls } = setup();
  assert.equal((await run({ action: "cancel" })).isError, true);
  assert.equal((await run({ action: "get" })).isError, true);
  const controller = new AbortController(); controller.abort();
  assert.equal((await run({ action: "submit" }, "aborted", controller.signal)).isError, true);
  assert.equal(calls.length, 0);
});

test("mobile artifact download verifies binary bytes and saves locally instead of delegating fs back to PC", async () => {
  const bytes = Buffer.from([0, 255, 1, 128, 12]);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const { run, nativeCalls } = setup({ readBackgroundArtifact() { return {
    artifact: { id: "artifact-1", relativePath: "report.pptx", bytes: bytes.length, contentHash }, contentBase64: bytes.toString("base64"),
  }; } });
  const result = await run({ action: "download", request_id: "receipt", artifact_id: "artifact-1" });
  assert.equal(result.isError, false);
  assert.equal(nativeCalls[0].command, "fs_create_binary");
  assert.equal(nativeCalls[0].args.workdir, "/phone/project");
  assert.equal(nativeCalls[0].args.path, "background-results/receipt/report.pptx");
  assert.equal(nativeCalls[0].args.expected_content_hash, contentHash);
});

test("a corrupt artifact cannot create a local file", async () => {
  const { run, nativeCalls } = setup({ readBackgroundArtifact() { return {
    artifact: { id: "a", relativePath: "a.docx", bytes: 3, contentHash: "wrong" }, contentBase64: "YWJj",
  }; } });
  assert.equal((await run({ action: "download", request_id: "receipt", artifact_id: "a" })).isError, true);
  assert.equal(nativeCalls.length, 0);
});

test("publication is pinned to the accepted execution, not a model supplied task ID", async () => {
  const { module, calls } = setup();
  const tools = module.createBackgroundArtifactTools("owned-execution", lease);
  const result = await tools.executeToolCall({ id: "publish", name: "PublishBackgroundArtifact", arguments: { path: "report.docx", executionId: "other" } });
  assert.equal(result.isError, false);
  assert.deepEqual(calls, [{ method: "publishBackgroundArtifact", args: ["owned-execution", "report.docx", undefined, lease] }]);
});

test("operation investigation requires a task receipt and preserves pagination", async () => {
  const page = { operations: [{ sequence: 12, state: "started", callId: "send" }], nextCursor: 12 };
  const { run, calls } = setup({ listBackgroundOperations: () => page });
  assert.equal((await run({ action: "operations" })).isError, true);
  const result = await run({ action: "operations", request_id: "owner", cursor: 10, limit: 5 });
  assert.equal(result.isError, false);
  assert.deepEqual(calls, [{ method: "listBackgroundOperations", args: ["owner", 10, 5] }]);
  assert.deepEqual(result.details.result, page);
});

test("archive investigation is read-only, paginated and pinned to the accepted execution", async () => {
  const page = { compactions: [{ sourceRevision: 3, sourceHash: "digest" }], nextCursor: 3 };
  const chunk = { sourceRevision: 3, offset: 16384, text: "original receipt", nextOffset: 32768 };
  const f = setup({ listBackgroundCompactions: () => page, readBackgroundContextArchive: () => chunk });
  const tools = f.module.createBackgroundArtifactTools("owned-execution", lease);
  assert.equal(tools.metadataByName.get("ReadBackgroundContext").isReadOnly, true);
  const run = (args, signal) => tools.executeToolCall({ id: "read", name: "ReadBackgroundContext", arguments: args }, signal);
  const listed = await run({ action: "list", cursor: 2, executionId: "other" });
  const read = await run({ action: "read", source_revision: 3, offset: 16384, executionId: "other" });
  assert.equal(listed.isError, false); assert.equal(read.isError, false);
  assert.deepEqual(listed.details.result, page); assert.deepEqual(read.details.result, chunk);
  assert.deepEqual(f.calls, [{ method: "listBackgroundCompactions", args: ["owned-execution", 2, lease] },
    { method: "readBackgroundContextArchive", args: ["owned-execution", 3, 16384, lease] }]);
  assert.equal(f.nativeCalls.length, 0);
  const callCount = f.calls.length;
  for (const args of [{ action: "list", cursor: -1 }, { action: "list", cursor: 1.5 },
    { action: "read", source_revision: 0 }, { action: "read", source_revision: 1, offset: "0" },
    { action: "read", source_revision: Number.MAX_SAFE_INTEGER + 1 }, { action: "delete" }]) {
    assert.equal((await run(args)).isError, true);
  }
  const controller = new AbortController(); controller.abort();
  assert.equal((await run({ action: "list" }, controller.signal)).isError, true);
  assert.equal(f.calls.length, callCount);
});

test("unavailable archives and cancellation after a native read report errors without writes", async () => {
  const controller = new AbortController();
  const f = setup({ listBackgroundCompactions() { throw new Error("lease expired"); },
    readBackgroundContextArchive() { controller.abort(); return { text: "old evidence" }; } });
  const tools = f.module.createBackgroundArtifactTools("owned-execution", lease);
  const run = (args, signal) => tools.executeToolCall({ id: "read", name: "ReadBackgroundContext", arguments: args }, signal);
  assert.match((await run({ action: "list" })).details.result.error, /lease expired/);
  assert.equal((await run({ action: "read", source_revision: 1 }, controller.signal)).isError, true);
  assert.ok(f.calls.every((call) => ["listBackgroundCompactions", "readBackgroundContextArchive"].includes(call.method)));
});

function hostInfo(id, overrides = {}) { return { hostId: id, platform: "macos", architecture: "aarch64", executorReady: true,
  acceptsBackgroundTasks: true, workspaceAvailable: true, workdir: `/workers/${id}`,
  providers: [{ id: `${id}-provider`, name: "provider", providerType: "codex", models: ["host-model", "other-model"] }],
  pending: 0, running: 0, observedAt: 100, delegationVersion: 1, childTasksVersion: 1, ...overrides }; }

const observedHost = (id, overrides = {}) => {
  const now = Date.now();
  return hostInfo(id, { inputSnapshotVersion: 1, inventory: { version: 1, observedAt: now - 100, validUntil: now + 59900, capabilities: [{ id: "xcode", state: "available", evidence: "version-command", detail: "Xcode actual version" }] }, ...overrides });
};
const catalogOf = hosts => ({ peers: hosts.map(host => ({ peerId: host.hostId, online: true, host })) });

const specialistHost = (id, skill = "coding") => observedHost(id, {
  observedAt: Date.now(), modelRoutingVersion: 1,
  providers: [{ id: `${id}-provider`, name: "Configured", providerType: "codex", models: ["primary", "specialist"], modelProfiles: [
    { model: "primary", skills: [], backgroundPending: 0, backgroundRunning: 0, backgroundWaiting: 0 },
    { model: "specialist", skills: [skill], backgroundPending: 0, backgroundRunning: 0, backgroundWaiting: 0 },
  ] }],
});

test("model specialty routing persists the actual selected provider/model and receiver requirement", async () => {
  const coding = specialistHost("coding"), research = specialistHost("research", "research");
  const f = setup({ listWorkerPeers: () => catalogOf([research, coding]), getLocalWorkerHostInfo: () => null, probeWorkerPeer: id => id === "coding" ? coding : research });
  const result = await f.run({ action: "submit", name: "Website", prompt: "Implement the actual website", requirements: { modelSkills: ["coding"] } });
  assert.equal(result.isError, false);
  const submit = f.calls.find(c => c.method === "submitBackgroundTask");
  assert.equal(submit.args[1], "coding"); assert.equal(submit.args[0].providerId, "coding-provider"); assert.equal(submit.args[0].model, "specialist");
  assert.deepEqual(submit.args[0].requirements, { capabilities: [], platforms: [], modelSkills: ["coding"] });
});

test("specialty mismatch after re-probe or explicit model pin never dispatches another model", async () => {
  const coding = specialistHost("coding");
  for (const [probe, model] of [[specialistHost("coding", "research"), undefined], [coding, "primary"]]) {
    const f = setup({ listWorkerPeers: () => catalogOf([coding]), getLocalWorkerHostInfo: () => null, probeWorkerPeer: () => probe });
    assert.equal((await f.run({ action: "submit", name: "Code", prompt: "Implement it", model, requirements: { modelSkills: ["coding"] } })).isError, true);
    assert.equal(f.calls.some(c => c.method === "submitBackgroundTask"), false);
  }
});

test("saved original ownership outranks new idle specialists and read-only recommendation exposes selected binding", async () => {
  const original = specialistHost("original", "research"), idle = specialistHost("idle");
  const f = setup({ getBackgroundSubmissionState: () => ({ sourceHostId: "original", localExecution: false, cancelRequested: false }), listWorkerPeers: () => catalogOf([idle]), getLocalWorkerHostInfo: () => null, probeWorkerPeer: () => original });
  assert.equal((await f.run({ action: "submit", name: "Code", prompt: "Same task", requirements: { modelSkills: ["coding"] } })).isError, true);
  assert.equal(f.calls.some(c => c.method === "listWorkerPeers" || c.method === "submitBackgroundTask"), false);
  const result = await f.tools.executeToolCall({ id: "recommend", name: "WorkerDevices", arguments: { requirements: { modelSkills: ["coding"] }, provider_id: "idle-provider", model: "specialist" } });
  assert.equal(result.isError, false); assert.deepEqual(result.details.result.selected.model, { providerId: "idle-provider", model: "specialist" });
  assert.equal(f.calls.some(c => c.method === "submitBackgroundTask"), false);
});

test("automatic requirement routing selects the eligible desktop and preserves its model, workspace and requirements", async () => {
  const mac = observedHost("mac"), windows = observedHost("windows", { platform: "windows" });
  const f = setup({ listWorkerPeers: () => catalogOf([windows, mac]), probeWorkerPeer: id => observedHost(id) }, { requirePeer: true });
  const result = await f.run({ action: "submit", name: "IPA", prompt: "Inspect signing and build", requirements: { capabilities: ["xcode"], platforms: ["macos"] } });
  assert.equal(result.isError, false); const submit = f.calls.find(c => c.method === "submitBackgroundTask");
  assert.equal(submit.args[1], "mac"); assert.equal(submit.args[0].model, "host-model"); assert.equal(submit.args[0].workdir, "/workers/mac");
  assert.deepEqual(submit.args[0].requirements, { capabilities: ["xcode"], platforms: ["macos"] });
  assert.equal(f.calls.some(c => c.method === "getLocalWorkerHostInfo"), false);
});

test("eligible local routing explicitly bypasses mutable selected-LAN transport", async () => {
  const local = observedHost("local"); const f = setup({ listWorkerPeers: () => catalogOf([observedHost("remote")]), getLocalWorkerHostInfo: () => local });
  const result = await f.run({ action: "submit", name: "IPA", prompt: "Inspect actual project", requirements: { capabilities: ["xcode"] } });
  assert.equal(result.isError, false); const submit = f.calls.find(c => c.method === "submitBackgroundTask");
  assert.equal(submit.args[1], undefined); assert.equal(submit.args[4], true); assert.equal(submit.args[0].workdir, "/workers/local"); assert.equal(submit.args[0].providerId, "local-provider");
});

test("locally routed attachments use local protocol evidence and verified local bytes even when another PC is globally selected", async () => {
  const bytes = Buffer.from("actual local document"), contentHash = createHash("sha256").update(bytes).digest("hex");
  const f = setup({ listWorkerPeers: () => catalogOf([]), getLocalWorkerHostInfo: () => observedHost("local"), getBackgroundHostInfo: () => { throw new Error("Wrong selected global PC"); }, nativeInvoke: command => { assert.equal(command, "fs_snapshot_binary"); return { bytes: bytes.length, contentBase64: bytes.toString("base64"), contentHash }; } });
  const result = await f.run({ action: "submit", name: "IPA", prompt: "Process the attachment", files: [{ path: "document.txt" }], requirements: { capabilities: ["xcode"] } });
  assert.equal(result.isError, false); const submit = f.calls.find(c => c.method === "submitBackgroundTask");
  assert.equal(submit.args[4], true); assert.equal(submit.args[0].files[0].contentHash, contentHash);
  assert.equal(f.calls.some(c => c.method === "getBackgroundHostInfo"), false); assert.equal(f.nativeCalls[0].args.workdir, "/phone/project");
});

test("saved ownership prevents reselection and uncertainty never migrates to a better available host", async () => {
  const f = setup({ getBackgroundSubmissionState: () => ({ sourceHostId: "original", localExecution: false, cancelRequested: false }), probeWorkerPeer: () => { throw new Error("Original worker offline"); }, listWorkerPeers: () => catalogOf([observedHost("replacement")]) });
  const result = await f.run({ action: "submit", name: "IPA", prompt: "Same actual request", requirements: { capabilities: ["xcode"] } });
  assert.equal(result.isError, true); assert.equal(result.details.result.peerId, "original"); assert.equal(f.calls.some(c => ["listWorkerPeers", "submitBackgroundTask"].includes(c.method)), false);
});

test("automatic worker delegation excludes ancestors and retains captured parent lease", async () => {
  const f = setup({ listWorkerPeers: () => catalogOf([observedHost("current"), observedHost("child")]), probeWorkerPeer: id => observedHost(id) }, { backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: ["current"] } });
  const result = await f.run({ action: "submit", name: "IPA", prompt: "Inspect then build", requirements: { capabilities: ["xcode"] } });
  assert.equal(result.isError, false); const submit = f.calls.find(c => c.method === "submitBackgroundTask");
  assert.equal(submit.args[1], "child"); assert.deepEqual(submit.args[2], lease); assert.deepEqual(submit.args[0].delegation.ancestorHostIds, ["current"]);
  assert.equal(f.calls.some(c => ["getBackgroundSubmissionState", "getLocalWorkerHostInfo"].includes(c.method)), false);
});

test("requirements recommendation is read-only and unavailable candidates submit no work", async () => {
  const f = setup({ listWorkerPeers: () => catalogOf([observedHost("mac", { inventory: undefined })]) }, { requirePeer: true });
  const recommendation = await f.tools.executeToolCall({ id: "recommend", name: "WorkerDevices", arguments: { requirements: { capabilities: ["xcode"] } } });
  assert.equal(recommendation.isError, false); assert.equal(recommendation.details.result.selected, null); assert.ok(recommendation.details.result.rejected[0].reason);
  const failed = await f.run({ action: "submit", requirements: { capabilities: ["xcode"] } }); assert.equal(failed.isError, true); assert.equal(f.calls.some(c => c.method === "submitBackgroundTask"), false);
});

test("background handoff preserves its actual parent and chain regardless of model arguments", async () => {
  const parent = { rootRequestId: "root", requestId: "parent", hostIds: ["first", "current"] };
  const fixture = setup({ probeWorkerPeer: (id) => hostInfo(id) }, { backgroundContext: parent });
  const result = await fixture.run({ action: "submit", peer_id: "next", name: "child", prompt: "build",
    delegation: { rootRequestId: "invented", ancestorHostIds: [] } });
  assert.equal(result.isError, false);
  assert.deepEqual(fixture.calls.at(-1).args[0].delegation, {
    rootRequestId: "root", parentRequestId: "parent", ancestorHostIds: ["first", "current"],
  });
  assert.notEqual(fixture.calls.at(-1).args[0].delegation.ancestorHostIds, parent.hostIds);
});

test("delegation and publication capture native authority rather than model fields or later mutations", async () => {
  const mutableLease = { ...lease };
  const f = setup({ probeWorkerPeer: (id) => hostInfo(id) }, {
    backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: ["current"] }, backgroundLease: mutableLease,
  });
  const artifacts = f.module.createBackgroundArtifactTools("owned", mutableLease);
  mutableLease.generation++;
  mutableLease.attempt++;
  mutableLease.token = "22222222-2222-4222-8222-222222222222";
  assert.equal((await f.run({ action: "submit", peer_id: "next", name: "child", prompt: "build", parent_lease: mutableLease })).isError, false);
  assert.deepEqual(f.calls.at(-1).args[2], lease);
  assert.equal(JSON.stringify(f.calls.at(-1).args[0]).includes(lease.token), false);
  assert.equal((await artifacts.executeToolCall({ id: "publish", name: "PublishBackgroundArtifact", arguments: { path: "report.docx", lease: mutableLease } })).isError, false);
  assert.deepEqual(f.calls.at(-1).args[3], lease);
});

test("an unfenced parent cannot probe or submit delegated work", async () => {
  const f = setup({}, { backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: ["current"] }, backgroundLease: undefined });
  const result = await f.run({ action: "submit", peer_id: "next", name: "child", prompt: "build" });
  assert.equal(result.isError, true);
  assert.match(result.details.result.error, /captured parent execution lease/);
  assert.equal(f.calls.length, 0);
});

test("worker rejects self, ancestors and local handoffs before probing or accepting work", async () => {
  for (const peer of [undefined, "first", "current"]) {
    const fixture = setup({ probeWorkerPeer: (id) => hostInfo(id) }, {
      backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: ["first", "current"] },
    });
    assert.equal((await fixture.run({ action: "submit", peer_id: peer })).isError, true);
    assert.equal(fixture.calls.length, 0);
  }
});

test("a persisted receipt cannot bypass cycle prevention by omitting the peer argument", async () => {
  const fixture = setup({ resolveBackgroundPeer: () => "ancestor" }, {
    backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: ["ancestor", "current"] },
  });
  const result = await fixture.run({ action: "submit", request_id: "child" });
  assert.equal(result.isError, true);
  assert.match(result.details.result.error, /cycle/);
  assert.equal(fixture.calls.length, 0);
});

test("eight-host chain accepts no ninth worker but still permits child result recovery", async () => {
  const fixture = setup({ probeWorkerPeer: (id) => hostInfo(id) }, {
    backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: Array.from({ length: 8 }, (_, i) => `host-${i}`) },
  });
  const result = await fixture.run({ action: "submit", peer_id: "ninth" });
  assert.equal(result.isError, true);
  assert.match(result.details.result.error, /host limit/);
  assert.equal(fixture.calls.length, 0);
  assert.equal((await fixture.run({ action: "get", request_id: "child", peer_id: "last" })).isError, false);
});

test("background workers require chain support while ordinary clients can submit to legacy hosts", async () => {
  const overrides = { probeWorkerPeer: (id) => hostInfo(id, { delegationVersion: undefined }) };
  const worker = setup(overrides, {
    backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: ["current"] },
  });
  assert.equal((await worker.run({ action: "submit", peer_id: "legacy" })).isError, true);
  assert.equal(worker.calls.some((call) => call.method === "submitBackgroundTask"), false);
  const client = setup(overrides);
  assert.equal((await client.run({ action: "submit", peer_id: "legacy", name: "task", prompt: "do work" })).isError, false);
  assert.equal(client.calls.at(-1).args[0].delegation, undefined);
});

test("last permitted handoff and its retries retain one immutable lineage and request ID", async () => {
  const fixture = setup({ probeWorkerPeer: (id) => hostInfo(id) }, {
    backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: Array.from({ length: 7 }, (_, i) => `host-${i}`) },
    requestScope: "parent-execution",
  });
  const args = { action: "submit", peer_id: "eighth", name: "child", prompt: "do work" };
  assert.equal((await fixture.run(args)).isError, false);
  assert.equal((await fixture.run(args)).isError, false);
  const submissions = fixture.calls.filter((call) => call.method === "submitBackgroundTask");
  assert.deepEqual(submissions[0], submissions[1]);
  assert.equal(submissions[0].args[0].delegation.ancestorHostIds.length, 7);
});

test("two peers can accept concurrent tasks with their own configured models and workspaces", async () => {
  const { run, calls } = setup({ probeWorkerPeer: (id) => hostInfo(id), submitBackgroundTask: (input, peerId) => ({ requestId: input.requestId, hostId: peerId }) });
  const results = await Promise.all([run({ action: "submit", peer_id: "mac", name: "IPA", prompt: "inspect environment and build" }, "mac-call"),
    run({ action: "submit", peer_id: "windows", name: "DOCX", prompt: "create and publish report" }, "windows-call")]);
  assert.ok(results.every((r) => !r.isError));
  const submissions = calls.filter((c) => c.method === "submitBackgroundTask");
  assert.equal(submissions.length, 2);
  for (const { args: [input, peerId] } of submissions) {
    assert.equal(input.providerId, `${peerId}-provider`); assert.equal(input.workdir, `/workers/${peerId}`);
    assert.equal(input.model, "host-model");
  }
  assert.deepEqual(results.map((r) => r.details.result.peerId), ["mac", "windows"]);
});

test("peer selection accepts only an actually advertised provider/model", async () => {
  const { run, calls } = setup({ probeWorkerPeer: (id) => hostInfo(id) });
  const rejected = await run({ action: "submit", peer_id: "mac", provider_id: "invented", model: "invented" });
  assert.equal(rejected.isError, true);
  assert.equal(calls.filter((c) => c.method === "submitBackgroundTask").length, 0);
  assert.equal((await run({ action: "submit", peer_id: "mac", provider_id: "mac-provider", model: "other-model", name: "task", prompt: "do work" })).isError, false);
  assert.equal(calls.at(-1).args[0].model, "other-model");
});

test("unready, unauthorized, missing-workspace, identity-changed and model-less hosts accept no task", async () => {
  for (const override of [{ executorReady: false }, { acceptsBackgroundTasks: false }, { workspaceAvailable: false }, { hostId: "replacement" }, { providers: [] }]) {
    const { run, calls } = setup({ probeWorkerPeer: (id) => hostInfo(id, override) });
    assert.equal((await run({ action: "submit", peer_id: "mac", name: "task", prompt: "do work" })).isError, true);
    assert.equal(calls.filter((c) => c.method === "submitBackgroundTask").length, 0);
  }
});

test("a persisted request owner overrides the current desktop and rejects migration before probing", async () => {
  const { run, calls } = setup({ resolveBackgroundPeer: () => "original", probeWorkerPeer: (id) => hostInfo(id) });
  assert.equal((await run({ action: "submit", peer_id: "replacement", request_id: "receipt" })).isError, true);
  assert.equal(calls.length, 0);
  const result = await run({ action: "submit", request_id: "receipt", name: "task", prompt: "same work" });
  assert.equal(result.isError, false);
  assert.equal(calls.at(-1).args[1], "original");
});

test("an uncertain peer submission returns both recovery identifiers and never picks another peer", async () => {
  const { run, calls } = setup({ probeWorkerPeer: (id) => hostInfo(id), submitBackgroundTask: () => { throw new Error("acceptance reply lost"); } });
  const result = await run({ action: "submit", peer_id: "original", name: "task", prompt: "do work" });
  assert.equal(result.isError, true);
  assert.equal(result.details.result.peerId, "original");
  assert.ok(result.details.result.requestId);
  assert.equal(calls.filter((c) => c.method === "submitBackgroundTask").length, 1);
});

test("worker discovery preserves offline evidence and read-only task classification excludes mutations", async () => {
  const catalog = { peers: [{ peerId: "offline", online: false, host: hostInfo("offline"), error: "unreachable" }] };
  const { tools, module } = setup({ listWorkerPeers: () => catalog });
  const result = await tools.executeToolCall({ id: "discover", name: "WorkerDevices", arguments: {} });
  assert.equal(result.isError, false); assert.deepEqual(result.details.result, catalog);
  assert.equal(tools.metadataByName.get("WorkerDevices").isReadOnly, true);
  for (const action of ["get", "list", "operations"]) assert.equal(module.isBackgroundTaskReadOnly({ name: "BackgroundTask", arguments: { action } }), true);
  for (const action of ["submit", "cancel", "download"]) assert.equal(module.isBackgroundTaskReadOnly({ name: "BackgroundTask", arguments: { action } }), false);
});

test("an unpaired mobile cannot claim local durable background execution", async () => {
  const { module, calls } = setup();
  const tools = module.createBackgroundTaskTools({ workdir: "/phone", currentChatModel: { customProviderId: "p", model: "m" }, requirePeer: true });
  const result = await tools.executeToolCall({ id: "mobile-task", name: "BackgroundTask", arguments: { action: "submit", name: "task", prompt: "continue after phone exits" } });
  assert.equal(result.isError, true);
  assert.match(result.details.result.error, /paired worker/);
  assert.equal(calls.filter((c) => c.method === "submitBackgroundTask").length, 0);
});

test("content-derived DSML call IDs are isolated across task contexts while retries keep one request", async () => {
  const { parseDsmlToolCallMarkup } = createTsModuleLoader().loadModule("src/lib/chat/runner/deepSeekDsml.ts");
  const markup = '<||DSML||invoke name="BackgroundTask"><||DSML||parameter name="action">submit</||DSML||parameter><||DSML||parameter name="name">report</||DSML||parameter><||DSML||parameter name="prompt">create a real report</||DSML||parameter></||DSML||invoke>';
  const [call] = parseDsmlToolCallMarkup(markup);
  assert.equal(call.id, parseDsmlToolCallMarkup(markup)[0].id);
  const first = setup({}, { requestScope: "conversation-one/turn-one" });
  const nextTurn = setup({}, { requestScope: "conversation-one/turn-two" });
  const nextConversation = setup({}, { requestScope: "conversation-two/turn-one" });
  const reloaded = setup({}, { requestScope: "conversation-one/turn-one" });
  for (const fixture of [first, nextTurn, nextConversation, reloaded]) await fixture.tools.executeToolCall(call);
  const ids = [first, nextTurn, nextConversation].map((fixture) => fixture.calls[0].args[0].requestId);
  assert.equal(new Set(ids).size, 3);
  assert.equal(reloaded.calls[0].args[0].requestId, ids[0]);
});

const modelParentOptions = { backgroundContext: { requestId: "parent", rootRequestId: "root", hostIds: ["issuer"] }, schedulingEnabled: true, requestScope: "original-execution", getSourceContext: () => { throw new Error("A private model child must not copy the coordinator conversation"); } };
const modelChildArgs = { action: "submit", execution: "model", name: "Slides", prompt: "Produce and verify slides from accepted documents", requirements: { modelSkills: ["coding"] }, delegation_budget: { max_model_requests: 10, max_tool_calls: 20 } };
const scopedChildId = (scope, call) => { const hash = createHash("sha256").update(`xgent-background:${JSON.stringify([scope,call])}`).digest("hex"); return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`; };
const modelReceipt = (scope,call) => ({ requestId: scopedChildId(scope,call), hostId: "issuer", run: { id: "independent-execution", state: "pending" } });

test("persistent model child uses the native original execution/lease and exact declared specialist without device routing", async () => {
  const f=setup({ getLocalWorkerHostInfo: () => specialistHost("issuer"), submitBackgroundModelTask: (scope,call) => modelReceipt(scope,call) },modelParentOptions);
  const result=await f.run(modelChildArgs,"durable-child"); assert.equal(result.isError,false);
  assert.deepEqual(f.calls.map(c=>c.method),["getLocalWorkerHostInfo","submitBackgroundModelTask"]);
  assert.deepEqual(f.calls[1].args,["original-execution","durable-child",lease,"issuer-provider","specialist"]);
  assert.equal(f.ownershipCalls.length,0); assert.equal(f.nativeCalls.length,0);
  assert.equal(result.details.result.peerId,"issuer"); assert.equal(result.details.result.result.run.state,"pending");
});

test("model children are unavailable without captured scheduled native parent authority", async () => {
  for(const options of [{}, {...modelParentOptions,schedulingEnabled:false}, {...modelParentOptions,backgroundLease:undefined}, {...modelParentOptions,requestScope:undefined}]) {
    const f=setup({getLocalWorkerHostInfo:()=>specialistHost("issuer")},options);
    assert.equal((await f.run(modelChildArgs)).isError,true); assert.equal(f.calls.length,0);
  }
  for(const host of [null,specialistHost("other"),{...specialistHost("issuer"),executorReady:false}]) {
    const f=setup({getLocalWorkerHostInfo:()=>host},modelParentOptions);
    assert.equal((await f.run(modelChildArgs)).isError,true); assert.ok(!f.calls.some(c=>c.method==="submitBackgroundModelTask"));
  }
});

test("model child cannot supply replacement owner, input files, goal, invalid allocation or nonexistent model",async()=>{
  for(const extra of [{peer_id:"other"},{request_id:"invented"},{files:[]},{goal_binding:goalBinding},{delegation_budget:undefined},{delegation_budget:{max_model_requests:0,max_tool_calls:2}},{delegation_budget:{max_model_requests:2,max_tool_calls:2,extra:true}},{provider_id:"missing"},{model:"missing"},{requirements:{modelSkills:["research"]}}]) {
    const f=setup({getLocalWorkerHostInfo:()=>specialistHost("issuer")},modelParentOptions);
    const result=await f.run({...modelChildArgs,...extra}); assert.equal(result.isError,true);assert.equal(result.details.outcomeUncertain,undefined); assert.ok(!f.calls.some(c=>c.method==="submitBackgroundModelTask"));
  }
});

test("lost or mismatched native model child ACK retains the scoped original request for journal recovery",async()=>{
  for(const reply of [()=>{throw new Error("ACK lost")},(scope,call)=>({...modelReceipt(scope,call),hostId:"different"}),(scope,call)=>({...modelReceipt(scope,call),requestId:"different"})]) {
    const f=setup({getLocalWorkerHostInfo:()=>specialistHost("issuer"),submitBackgroundModelTask:reply},modelParentOptions);
    const result=await f.run(modelChildArgs,"original-model-call");assert.equal(result.isError,true);assert.equal(result.details.outcomeUncertain,true);
    assert.equal(result.details.result.requestId,scopedChildId("original-execution","original-model-call"));
    assert.equal(result.details.result.peerId,"issuer");assert.equal(f.calls.filter(c=>c.method==="submitBackgroundModelTask").length,1);
  }
});

test("model children pin explicit complete model identity and do not alter synchronous Agent or default device behavior",async()=>{
  const f=setup({getLocalWorkerHostInfo:()=>specialistHost("issuer"),submitBackgroundModelTask:(scope,call)=>modelReceipt(scope,call)},modelParentOptions);
  assert.equal((await f.run({...modelChildArgs,provider_id:"issuer-provider",model:"specialist"})).isError,false);
  assert.deepEqual(f.calls[1].args.slice(-2),["issuer-provider","specialist"]);
  const normal=setup({probeWorkerPeer:()=>hostInfo("worker")});
  assert.equal((await normal.run({action:"submit",execution:"device",peer_id:"worker",name:"Report",prompt:"Create report"})).isError,false);
  assert.equal(normal.calls.filter(c=>c.method==="submitBackgroundTask").length,1);
  assert.equal(normal.calls.filter(c=>c.method==="submitBackgroundModelTask").length,0);
});
